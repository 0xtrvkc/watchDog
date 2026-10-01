# WatchDog · Two gold alerts

A small private HTML app: enter **exactly two gold prices**, receive one email when each target is reached or crossed. No subscriptions are required by this code. A Python backend monitors while the page is closed; the computer/server must stay awake and online.

## What “real time” means here

This uses the documented `https://api.gold-api.com/price/XAU` endpoint, returning gold in USD per troy ounce. The provider markets it as real-time data, but its integration docs ask clients to **cache for 30 seconds**. This app makes one shared request about every 30 seconds, honours longer `Cache-Control` values and `Retry-After`, and backs off on errors. Opening more browser tabs does not increase upstream requests.

**This is near-real-time polling, not a tick stream.** A price can touch your target and reverse between samples without triggering an alert. Feed latency and email delivery add delay. This feed may differ from your broker's bid/ask XAUUSD. For exact broker-level touch detection, replace the feed with that broker's officially authorised stream; access, entitlements and cost depend on the broker. No guarantee of zero missed touches or instantaneous inbox delivery is possible with this version.

The provider's published terms permit app/commercial use and prohibit abusive requests. We follow the documented caching interval, do not scrape chart sites, impersonate browsers, bypass access controls, or use private endpoints. Terms can change; links below were reviewed on 2026-10-01. These checks do not establish the provider's upstream licensing or amount to a guarantee about every applicable law.

## Start on your computer (free)

1. Install **Python 3.12 or newer** from https://www.python.org/downloads/.
2. Copy `.env.example` to `.env` in this folder.
3. Set a random `APP_PASSWORD` (at least 16 characters).
4. Fill in `SMTP_USER`, `MAIL_FROM` and `MAIL_TO` with your email address. For Gmail, turn on 2-Step Verification and create an **App Password** at https://myaccount.google.com/apppasswords. Put that generated password in `SMTP_PASSWORD`. Do not use or share your normal Google password. App Password availability depends on your account's security settings/policy. Other SMTP providers can be used instead.
5. Open a terminal in this folder and run:

   ```sh
   python server.py
   ```

   On Windows, `py server.py` also works.

6. Open **http://localhost:8080**, sign in with your app password, and click **Test email**. A successful test means SMTP accepted the message; check inbox/spam to confirm arrival.
7. Enter two different target prices and click **Save & arm both alerts**.

No pip installs, npm packages, data API key or email-service subscription are required. Email still follows your provider's account requirements and sending limits. Turn off computer sleep while monitoring. Closing the browser is fine; closing the Python process stops monitoring.

## Use it from your phone

For your **trusted home Wi-Fi only**, set `HOST=0.0.0.0` and `PUBLIC_ORIGIN=http://YOUR-COMPUTER-LAN-IP:8080` in `.env`. Restart the server. On your phone, open that exact address. Allow the computer's firewall to accept port 8080 on your private network only. The computer must remain awake. This local HTTP option is not encrypted; use only on a network you trust.

For access away from home, run one instance on an always-on machine and put it behind an HTTPS reverse proxy or authenticated private tunnel. Set `PUBLIC_ORIGIN` to the exact HTTPS app origin. Protect port 8080 from direct internet access. This package includes a login but is intended for one private user, not a public multi-user service. Production hosts may block SMTP or sleep on free tiers; verify before choosing one. We do not promise permanent free cloud hosting.

**GitHub Pages cannot run the Python monitor or keep SMTP secrets. GitHub Actions schedules are not a real-time monitor.** Storing code in GitHub does not activate alerts. Do not add a workflow that repeatedly polls every few seconds or tries to avoid free-host sleep restrictions.

Optional Docker setup:

```sh
docker compose up -d --build
```

The compose setup exposes the app only at localhost. Place your HTTPS proxy on the same host. The named volume preserves state. `.env` provides the email/app credentials and is excluded from the image and Git. There should be only one running instance per data file.

## Alert behaviour

- Target above current price: trigger at or above it. Target below: trigger at or below it. You can put both targets on the same side. Exact equality to the current quote is rejected at arming time to avoid a confusing immediate alert.
- The first fresh sample at or beyond the target triggers it, even if the feed jumps over the exact price. This also applies on restart; a brief excursion while offline that has already reversed cannot be recovered.
- Each target sends once and disarms. Click Save to rearm both using the current price as a new baseline. Pause cancels armed and queued alerts; an SMTP transaction already in flight can finish before Pause returns.
- Target settings, triggered events, retry queue and accepted-email status persist in `data/state.json`. Back up this file if needed. No full price history is collected.
- Failed email sends retry with increasing delays, up to 10 attempts. A rare crash after SMTP acceptance but before saving, or an ambiguous SMTP timeout, can cause a duplicate on retry. SMTP cannot guarantee exactly-once delivery. Each alert has a stable Message-ID.
- Quotes more than 120 seconds old, future-dated by more than 10 seconds, or out of order do not trigger. Keep the server clock synchronised. During a market closure or outage, the page reports no fresh quote. The source provides no official market-open flag, so the app does not invent a weekend trading calendar.
- Credentials remain server-side. Sign-in uses an HttpOnly, SameSite session cookie, Secure on HTTPS. Requests must match the configured origin. Sessions expire after a day and restart invalidates them; monitoring continues regardless of login sessions.

## Get the source

```sh
git clone https://github.com/0xtrvkc/watchDog.git
cd watchDog
```

Follow the setup steps above to run the app. Commit `.env.example`, never `.env` or `data/state.json`. Git ignores those private files. Storing this repository on GitHub does not create a hosted monitoring service by itself.

## Verification

```sh
python -m unittest discover -s tests -v
```

Tests mock email delivery; they never send real messages. They cover upward/downward thresholds, exact hits, skipped prices, independent same-side targets, one-shot behaviour, restart/retry persistence, pause, stale/replayed quotes, invalid targets, caching and API authentication/origin checks.

## References reviewed

| Reference | Finding / use |
|---|---|
| https://github.com/xdec/gold-price-api | Python API polling and price storage example; GPL-3.0. Its README's old third-party quotas are not treated as current. |
| https://github.com/lizhuoxi/XAUUSD-Price-Realtime | Older Python 2 quote/email script, using an undocumented quote endpoint with browser-like headers. No licence was visible in the repository listing. |
| https://github.com/KlodCripta/xauwatch | Shell monitor using Swissquote public quotes and freegoldapi.com historical data. No licence was visible in the repository listing. |
| https://gold-api.com/docs and https://gold-api.com/llms.txt | Official free price endpoint, USD defaults, response timestamps and 30-second cache guidance. |
| https://gold-api.com/terms | Official permitted app/commercial use and anti-abuse terms. |
| https://support.google.com/accounts/answer/185833 | Official Google App Password requirements. |

The three repositories informed the review only. **No code was copied from them**. This app is an independent implementation and uses Gold API's documented endpoint instead. API/data rights remain governed by the provider's terms, separate from the code licence.
