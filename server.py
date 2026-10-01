"""Private two-level gold alerts. Python 3.12+, standard library only."""
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import smtplib
import ssl
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API = 'https://api.gold-api.com/price/XAU'


def load_env():
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def valid_price(value):
    if isinstance(value, bool):
        raise ValueError('Enter a positive price.')
    try:
        price = float(value)
    except (TypeError, ValueError):
        raise ValueError('Enter a positive price.') from None
    if not math.isfinite(price) or price <= 0 or price > 1000000:
        raise ValueError('Enter a price between 0 and 1,000,000 USD.')
    return price


def fresh(quote, now=None):
    return quote is not None and -10 <= (now or time.time()) - quote['timestamp'] <= 120


def fetch_quote():
    request = urllib.request.Request(API, headers={'User-Agent': 'GoldTwoAlerts/1.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        data = json.loads(response.read(16384))
        cache = response.headers.get('Cache-Control', '')
    if data.get('symbol') != 'XAU' or data.get('currency') != 'USD':
        raise ValueError('Unexpected price instrument.')
    stamp = datetime.fromisoformat(data['updatedAt'].replace('Z', '+00:00'))
    if stamp.tzinfo is None:
        raise ValueError('Price timestamp has no timezone.')
    quote = {'price': valid_price(data['price']), 'timestamp': stamp.timestamp(), 'updatedAt': data['updatedAt']}
    if not fresh(quote):
        raise ValueError('Feed is stale or market is closed.')
    match = re.search(r'(?:^|,)\s*max-age=(\d+)', cache)
    return quote, max(30, int(match.group(1)) if match else 30)


class Engine:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.state = {'quote': None, 'levels': [], 'pending': [], 'feedError': '', 'mailError': '', 'lastSent': None}
        if self.path.exists():
            self.state.update(json.loads(self.path.read_text()))

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.path.with_suffix('.tmp')
        temp.write_text(json.dumps(self.state, allow_nan=False))
        try:
            temp.chmod(0o600)
        except OSError:
            pass
        temp.replace(self.path)

    def snapshot(self):
        with self.lock:
            result = json.loads(json.dumps(self.state))
            result['fresh'] = fresh(result['quote']) and not result['feedError']
            result.pop('pending')
            return result

    def arm(self, values):
        if not isinstance(values, list) or len(values) != 2:
            raise ValueError('Enter exactly two prices.')
        prices = [valid_price(v) for v in values]
        if prices[0] == prices[1]:
            raise ValueError('Use two different prices.')
        with self.lock:
            quote = self.state['quote']
            if not fresh(quote) or self.state['feedError']:
                raise ValueError('Wait for a fresh price before saving alerts.')
            if any(p == quote['price'] for p in prices):
                raise ValueError('Choose a target above or below the current price.')
            if self.state['pending']:
                raise ValueError('An email is pending. Pause to cancel it before setting new targets.')
            self.state['levels'] = [
                {'id': secrets.token_hex(8), 'target': p,
                 'direction': 'up' if p > quote['price'] else 'down', 'status': 'armed'} for p in prices
            ]
            self.state['mailError'] = ''
            self.save()

    def pause(self):
        with self.lock:
            for level in self.state['levels']:
                if level['status'] in ('armed', 'pending', 'failed'):
                    level['status'] = 'paused'
            self.state['pending'] = []
            self.state['mailError'] = ''
            self.save()

    def observe(self, quote):
        if not fresh(quote):
            raise ValueError('Feed is stale or market is closed.')
        with self.lock:
            previous = self.state['quote']
            self.state['feedError'] = ''
            if previous and quote['timestamp'] <= previous['timestamp']:
                return
            self.state['quote'] = quote
            for level in self.state['levels']:
                reached = quote['price'] >= level['target'] if level['direction'] == 'up' else quote['price'] <= level['target']
                if level['status'] == 'armed' and reached:
                    level['status'] = 'pending'
                    level['hitAt'] = quote['updatedAt']
                    self.state['pending'].append({
                        'id': level['id'], 'target': level['target'], 'quote': quote,
                        'attempts': 0, 'nextTry': 0,
                    })
            self.save()

    def deliver(self, sender):
        # Lock coordinates save/pause with an in-flight SMTP transaction.
        with self.lock:
            for event in list(self.state['pending']):
                if event['nextTry'] > time.time():
                    continue
                try:
                    sender(event)
                except Exception:
                    event['attempts'] += 1
                    event['nextTry'] = time.time() + min(900, 60 * 2 ** min(event['attempts'] - 1, 4))
                    self.state['mailError'] = 'Email failed; check SMTP settings. Automatic retries are pending.'
                    if event['attempts'] >= 10:
                        self.state['pending'].remove(event)
                        for level in self.state['levels']:
                            if level['id'] == event['id']:
                                level['status'] = 'failed'
                        self.state['mailError'] = 'Email failed after 10 attempts. Check SMTP settings, then save targets to rearm.'
                else:
                    self.state['pending'].remove(event)
                    for level in self.state['levels']:
                        if level['id'] == event['id']:
                            level['status'] = 'sent'
                    self.state['lastSent'] = datetime.now(timezone.utc).isoformat()
                    if not self.state['pending']:
                        self.state['mailError'] = ''
                self.save()


def mail_ready():
    return all(os.environ.get(k) for k in ('SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM', 'MAIL_TO'))


def send_mail(event=None):
    if not mail_ready():
        raise ValueError('Email is not configured.')
    message = EmailMessage()
    message['From'] = os.environ['MAIL_FROM']
    message['To'] = os.environ['MAIL_TO']
    if event:
        message['Subject'] = f"Gold alert: ${event['target']:,.2f} reached"
        # Stable Message-ID helps recipients identify retries; SMTP has no exactly-once guarantee.
        message['Message-ID'] = f"<{event['id']}@gold-two-alerts.local>"
        message.set_content(
            f"Your gold target ${event['target']:,.2f} was reached or crossed.\n"
            f"Observed XAU/USD: ${event['quote']['price']:,.2f} per troy ounce.\n"
            f"Feed time (UTC): {event['quote']['updatedAt']}\n"
            'Source: gold-api.com. This target is now disarmed.\n'
            'Checks are about 30 seconds apart; broker prices may differ.\n')
    else:
        message['Subject'] = 'Gold alerts: email test'
        message.set_content('Email is connected. Save your two prices in the app to arm alerts.')
    host = os.environ['SMTP_HOST']
    port = int(os.environ.get('SMTP_PORT', '465'))
    context = ssl.create_default_context()
    if port == 465:
        smtp = smtplib.SMTP_SSL(host, port, timeout=20, context=context)
    else:
        smtp = smtplib.SMTP(host, port, timeout=20)
    with smtp:
        if port != 465:
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
        smtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
        if smtp.send_message(message):
            raise RuntimeError('Recipient was rejected.')


def poll(engine, stop):
    failures = 0
    while not stop.is_set():
        delay = 30
        try:
            quote, delay = fetch_quote()
            engine.observe(quote)
            failures = 0
        except Exception as exc:
            failures += 1
            delay = min(900, 30 * 2 ** min(failures - 1, 5))
            if isinstance(exc, urllib.error.HTTPError):
                # Respect throttling instead of changing identities or bypassing limits.
                retry = exc.headers.get('Retry-After', '')
                try:
                    delay = max(delay, int(retry))
                except ValueError:
                    try:
                        from email.utils import parsedate_to_datetime
                        delay = max(delay, parsedate_to_datetime(retry).timestamp() - time.time())
                    except (TypeError, ValueError):
                        pass
            with engine.lock:
                engine.state['feedError'] = 'No fresh quote: feed unavailable, stale, or market closed.'
                engine.save()
        engine.deliver(send_mail)
        stop.wait(delay)


def handler_factory(engine, password, origin):
    signing_key = secrets.token_bytes(32)
    failed_login = [0.0]
    auth_lock = threading.Lock()
    last_test = [0.0]
    secure = origin.startswith('https://')

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Do not log cookies, passwords, or private request contents.

        def reply(self, status, data, cookie=None, mime='application/json'):
            raw = json.dumps(data).encode() if mime == 'application/json' else data
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if cookie:
                self.send_header('Set-Cookie', cookie)
            self.end_headers()
            self.wfile.write(raw)

        def authenticated(self):
            try:
                cookie = SimpleCookie(self.headers.get('Cookie', ''))
                value = cookie['session'].value
                expires, signature = value.split('.')
                expected = hmac.new(signing_key, expires.encode(), hashlib.sha256).hexdigest()
                return int(expires) > time.time() and hmac.compare_digest(signature, expected)
            except (KeyError, ValueError):
                return False

        def do_GET(self):
            if self.path in ('/', '/app.js', '/style.css'):
                name, mime = {'/': ('index.html', 'text/html; charset=utf-8'),
                              '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
                              '/style.css': ('style.css', 'text/css; charset=utf-8')}[self.path]
                self.reply(200, (ROOT / 'public' / name).read_bytes(), mime=mime)
            elif self.path == '/api/state':
                if not self.authenticated():
                    return self.reply(401, {'error': 'Sign in to view your alerts.'})
                state = engine.snapshot()
                state['emailReady'] = mail_ready()
                state['email'] = os.environ.get('MAIL_TO', '')
                self.reply(200, state)
            else:
                self.reply(404, {'error': 'Not found.'})

        def do_POST(self):
            if self.headers.get('Origin') != origin:
                return self.reply(403, {'error': 'Open the app at its configured address.'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply(415, {'error': 'JSON required.'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= 2048:
                    return self.reply(413, {'error': 'Invalid request size.'})
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Invalid request.')
                if self.path == '/api/login':
                    with auth_lock:
                        if time.time() - failed_login[0] < 2:
                            return self.reply(429, {'error': 'Wait two seconds and try again.'})
                        if not hmac.compare_digest(str(body.get('password', '')).encode(), password.encode()):
                            failed_login[0] = time.time()
                            return self.reply(401, {'error': 'Incorrect app password.'})
                    expires = str(int(time.time() + 86400))
                    signature = hmac.new(signing_key, expires.encode(), hashlib.sha256).hexdigest()
                    cookie = f'session={expires}.{signature}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400'
                    if secure:
                        cookie += '; Secure'
                    return self.reply(200, {'ok': True}, cookie)
                if not self.authenticated():
                    return self.reply(401, {'error': 'Sign in first.'})
                if self.path == '/api/arm':
                    if not mail_ready():
                        raise ValueError('Configure email on the server first.')
                    engine.arm(body.get('prices'))
                elif self.path == '/api/pause':
                    engine.pause()
                elif self.path == '/api/test-email':
                    with auth_lock:
                        if time.time() - last_test[0] < 60:
                            return self.reply(429, {'error': 'Wait one minute before another email test.'})
                        last_test[0] = time.time()
                    try:
                        send_mail()
                    except Exception:
                        return self.reply(503, {'error': 'Email test failed. Check server SMTP settings.'})
                else:
                    return self.reply(404, {'error': 'Not found.'})
                self.reply(200, {'ok': True})
            except (ValueError, TypeError, json.JSONDecodeError) as exc:
                self.reply(400, {'error': str(exc)})

    return Handler


def main():
    load_env()
    password = os.environ.get('APP_PASSWORD', '')
    if len(password) < 16 or password == 'replace-with-a-long-random-password':
        raise SystemExit('Set APP_PASSWORD to at least 16 characters in .env.')
    for field in ('MAIL_FROM', 'MAIL_TO', 'SMTP_USER'):
        value = os.environ.get(field, '')
        if value and not re.fullmatch(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+', value):
            raise SystemExit(f'{field} must be a single email address.')
    host = os.environ.get('HOST', '127.0.0.1')
    port = int(os.environ.get('PORT', '8080'))
    origin = os.environ.get('PUBLIC_ORIGIN', f'http://localhost:{port}').rstrip('/')
    engine = Engine(os.environ.get('DATA_FILE', str(ROOT / 'data' / 'state.json')))
    stop = threading.Event()
    server = ThreadingHTTPServer((host, port), handler_factory(engine, password, origin))
    server.daemon_threads = True
    threading.Thread(target=poll, args=(engine, stop), daemon=True).start()
    print(f'Gold alerts ready: {origin}. Keep this process running.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
