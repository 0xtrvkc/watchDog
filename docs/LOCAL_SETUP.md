# Local Python setup (optional)

For cloud monitoring with your PC off, follow the [main README](../README.md). This guide is for the original Python/SMTP backend. Run its commands from the repository root.

**Set two gold prices. Get an email when each target is reached.**

WatchDog is a small, self-hosted gold price alert app with a mobile-friendly HTML interface and a Python backend. Run your own copy, connect your own email account, and choose your own two targets.

- Exactly two price targets, monitored independently.
- One email per target, then that target disarms.
- Monitoring continues when the browser is closed, while your server stays running.
- Saved targets and pending email retries survive a restart.
- No Python packages, npm dependencies, or paid data API key required.

Each installation is for **one private user** with one configured recipient. This repository is the source code, not a shared hosted alert service. Your alerts and credentials stay with your installation.

## Before you start

You need:

- [Python 3.12 or newer](https://www.python.org/downloads/), or Docker with Docker Compose.
- A computer/server that can stay awake and connected to the internet.
- An email account that permits SMTP sending. Gmail is one option; other SMTP providers can work too.

The app itself has no subscription fee. Your email provider and hosting may have their own limits or charges. Running on a computer you already own does not require a cloud hosting subscription.

### Price freshness

WatchDog reads **gold in USD per troy ounce** from [Gold API](https://gold-api.com). It checks about every **30 seconds**, or longer if the provider requests caching or encounters errors. All browser tabs share the backend's price request.

This is **near-real-time polling**. A brief touch and reversal between checks can be missed. Feed latency and email delivery add delay, and prices may differ from your broker's XAUUSD bid/ask. It is not a tick-by-tick feed or an order execution tool.

## Quick start

### 1. Get your own copy

Clone this repository:

```sh
git clone https://github.com/0xtrvkc/watchDog.git
cd watchDog
```

Alternatively, select **Code → Download ZIP** on GitHub and extract it. Open a terminal in the extracted folder containing `server.py`.

To maintain your own version on GitHub, **fork this repository** and clone your fork instead. Each person runs their own backend with their own settings.

### 2. Create your configuration

Copy `.env.example` to a file named **`.env`** in the same folder as `server.py`.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
```

**macOS / Linux:**

```sh
cp .env.example .env
```

You can also copy and rename the file using your file manager. Make sure it is `.env`, not `.env.txt`.

Open `.env` in a text editor. For Gmail, your settings should look like this:

```dotenv
APP_PASSWORD=replace-this-with-your-own-random-password
HOST=127.0.0.1
PORT=8080
PUBLIC_ORIGIN=http://localhost:8080

SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-address@gmail.com
SMTP_PASSWORD=your-generated-app-password
MAIL_FROM=your-address@gmail.com
MAIL_TO=your-address@gmail.com
```

Replace all password and email placeholders with **your own values**. You can use the same email address for the sender and recipient. `MAIL_TO` can also be a different address you control.

There are two different passwords:

| Setting | Purpose |
|---|---|
| `APP_PASSWORD` | Sign in to your WatchDog page. Choose a unique random password of at least 16 characters. |
| `SMTP_PASSWORD` | Let the backend send email through your provider. For Gmail, use a generated Google App Password. |

For Gmail:

1. Enable **2-Step Verification** on your Google account.
2. Open [Google App Passwords](https://myaccount.google.com/apppasswords).
3. Generate an App Password for WatchDog.
4. Put it in `SMTP_PASSWORD`, removing formatting spaces.

Use the generated App Password, **not your normal Google password**. Google may not offer App Passwords for some account/security settings or managed accounts; see [Google's instructions](https://support.google.com/accounts/answer/185833). If unavailable, use another SMTP provider that supports this authentication method.

Keep `.env` private. It is excluded by `.gitignore` and `.dockerignore`. Do not post it in GitHub issues or upload it to your repository.

### 3. Start the backend

**Windows:**

```powershell
py server.py
```

**macOS / Linux:**

```sh
python3 server.py
```

`python server.py` also works if that command points to Python 3.12 or newer. No dependency installation is needed.

Leave the terminal running. Open **http://localhost:8080** in your browser and sign in with your `APP_PASSWORD`.

### 4. Test email and set your targets

1. Click **Test email**.
2. Check your inbox and spam folder for the test message.
3. Enter two different gold prices.
4. Click **Save & arm both alerts**.

The backend automatically determines which direction each target needs:

| Target relative to the price when you save | Trigger |
|---|---|
| Above the current price | First fresh quote at or above the target |
| Below the current price | First fresh quote at or below the target |

For example, if the current quote is **$4,150**, targets of **$4,200** and **$4,100** watch for an upward move and a downward move respectively. Both targets can also be above or below the current price.

Each target sends once. To set new targets or rearm the old ones, click **Save & arm both alerts** again. Both targets are rearmed using the current quote as their new baseline. **Pause alerts** cancels armed targets and queued emails.

Close the browser whenever you want; monitoring continues. Closing the backend, turning off the computer, or letting it sleep stops monitoring.

## Access from your phone

### On your home Wi-Fi

1. Find the computer's local IP address, for example `192.168.1.50`.
2. Update `.env`:

   ```dotenv
   HOST=0.0.0.0
   PUBLIC_ORIGIN=http://192.168.1.50:8080
   ```

3. Restart the backend.
4. Connect your phone to the same trusted Wi-Fi.
5. Open **http://192.168.1.50:8080** and sign in.

Use your actual computer IP. Allow inbound port 8080 through the computer's firewall on the **private network only** if necessary. This local HTTP connection is not encrypted; use it only on a network you trust.

`PUBLIC_ORIGIN` must match the address you open, including the scheme and port. After changing it to your LAN address, use that address on your computer too.

### Away from home

Run the backend on an always-on machine behind an **HTTPS reverse proxy or an authenticated private tunnel**. Set `PUBLIC_ORIGIN` to the exact HTTPS address and keep port 8080 protected from direct public access.

The installation is intended for personal use, not as a public multi-user service. Confirm that your host permits background processes, persistent storage, and outbound SMTP. A sleeping free host will not reliably monitor prices.

**GitHub stores the code; it does not activate alerts.** GitHub Pages cannot run this Python backend. This repository includes no GitHub Actions monitoring workflow. Use your own computer or a suitable separate host for monitoring.

## Docker

Configure `.env` first, keeping `PORT=8080`. Then run:

```sh
docker compose up -d --build
```

Open **http://localhost:8080**. The Compose setup binds the published port to localhost and overrides `HOST` inside the container so the app is reachable through that port. To access it remotely, put your HTTPS proxy or private tunnel on the same host and configure `PUBLIC_ORIGIN` accordingly.

Useful commands:

```sh
# View backend output
docker compose logs -f

# Restart after editing .env
docker compose up -d --force-recreate

# Stop monitoring, keeping saved state
docker compose down
```

The `gold-state` named volume preserves targets and pending alerts. Do not delete the volume unless you intend to reset the saved state. Run only one instance per state file/volume.

## Configuration reference

| Variable | Description |
|---|---|
| `APP_PASSWORD` | Unique app login password, at least 16 characters. Replace the example value. |
| `HOST` | Listening address. Default: `127.0.0.1`. Use `0.0.0.0` only when needed for trusted network access or a protected deployment. |
| `PORT` | HTTP port. Default: `8080`. Keep `8080` with the provided Compose file. |
| `PUBLIC_ORIGIN` | Exact address used to open the app, such as `http://localhost:8080` or `https://alerts.example.com`. |
| `SMTP_HOST` | Your email provider's SMTP hostname. |
| `SMTP_PORT` | `465` for implicit TLS, or your provider's STARTTLS port, usually `587`. |
| `SMTP_USER` | SMTP login email address. |
| `SMTP_PASSWORD` | Provider-approved SMTP password or App Password. |
| `MAIL_FROM` | Single sender address permitted by your SMTP provider. |
| `MAIL_TO` | Single recipient address for your alerts. |
| `DATA_FILE` | Optional saved-state location. Default: `data/state.json` beside `server.py`; Docker uses `/data/state.json`. |

For a different email provider, follow its SMTP host, port, authentication, and sender requirements. This app supports password-based SMTP authentication with TLS; it does not implement OAuth login.

Restart the backend after changing `.env`. Environment variables already supplied by your host take precedence over values in `.env`.

## Troubleshooting

| What you see | What to check |
|---|---|
| Python command not found | Install Python 3.12+, then try `py` on Windows or `python3` on macOS/Linux. |
| App password setup error on startup | Replace the default `APP_PASSWORD` with your own password of at least 16 characters. |
| Cannot open the page | Check that the backend is running, the address/port is correct, and the firewall allows access where needed. |
| “Open the app at its configured address” | Open the exact address in `PUBLIC_ORIGIN`, or update that setting and restart. |
| Save button disabled | Wait for a fresh quote and check that all SMTP/email variables are filled in. |
| Email test failed | Check SMTP credentials, provider App Password requirements, TLS port, and whether the host blocks outbound SMTP. |
| Test accepted but no email in inbox | Check spam/junk, sender restrictions, and provider delivery logs. SMTP acceptance does not guarantee inbox placement. |
| No fresh quote / market closed | The provider is unavailable or its quote is stale. Monitoring backs off and resumes when fresh data returns. |
| Email pending | Sending failed and a retry is queued. Check SMTP settings; Pause cancels queued messages. |
| Email failed after 10 attempts | Fix the email configuration, restart if changed, test email, then save the targets again to rearm. |
| Google App Password stopped working | Google can revoke App Passwords after an account password change. Generate a new one if needed. |

## How monitoring behaves

- A fresh observed quote at or beyond a target triggers it, including a jump over the exact target price. Setting a target exactly equal to the current quote is rejected.
- Quotes older than 120 seconds, more than 10 seconds in the future, or out of order do not trigger. Keep the server clock synchronised.
- On restart, armed targets are evaluated against fresh quotes. A temporary crossing while the backend was offline cannot be recovered if the price has already reversed.
- Targets, queued emails, and accepted-email status persist in the state file. Back it up privately if needed. WatchDog does not store a full price history.
- Failed email sends retry with increasing delays, up to 10 attempts. Polling/backoff and time spent sending can make checks take longer than 30 seconds.
- SMTP cannot guarantee exactly-once delivery: an ambiguous timeout or crash after acceptance but before saving can cause a duplicate retry. Alert emails have a stable Message-ID.
- An email already being sent can finish before Pause returns.
- Login sessions expire after a day and are invalidated on backend restart. Monitoring does not depend on an active login session.

## Data source and permitted use

The app uses the documented [Gold API price endpoint](https://gold-api.com/docs). Its [integration guidance](https://gold-api.com/llms.txt) asks clients to cache for 30 seconds. WatchDog respects that minimum, longer cache headers, `Retry-After`, and error backoff. It does not scrape chart sites or bypass access controls.

The provider's [published terms](https://gold-api.com/terms) permit app/commercial use and prohibit API abuse. These references were reviewed on **2026-10-01**; terms and availability may change. The provider's data terms are separate from the code licence. This project does not certify the provider's upstream data licensing.

## Development

Run the tests from the repository folder:

```sh
python -m unittest discover -s tests -v
```

Use `py` or `python3` instead if appropriate for your system. Tests mock email sending and never send real messages. They cover target crossings, one-shot behaviour, restart and retry persistence, pause, stale/replayed quotes, invalid inputs, provider caching, and API authentication/origin checks.

| File | Purpose |
|---|---|
| `public/index.html`, `public/style.css`, `public/app.js` | Browser interface |
| `server.py` | Private API, price monitoring, saved state, and SMTP delivery |
| `.env.example` | Configuration template without real credentials |
| `tests/test_alerts.py` | Behaviour and API checks |
| `Dockerfile`, `compose.yaml` | Optional container setup |

When reporting a problem, include your Python version, operating system, and the error message. Remove passwords, cookies, and personal email addresses before sharing logs or screenshots.

## References and licence

These projects informed the initial review:

- [xdec/gold-price-api](https://github.com/xdec/gold-price-api): Python API polling and CSV storage.
- [lizhuoxi/XAUUSD-Price-Realtime](https://github.com/lizhuoxi/XAUUSD-Price-Realtime): An older quote/email monitoring example.
- [KlodCripta/xauwatch](https://github.com/KlodCripta/xauwatch): A terminal gold price monitor.

No code was copied from those repositories. WatchDog is an independent implementation.

WatchDog's source is available under the [MIT License](../LICENSE). You can use, modify, and run your own copy under that licence; data and email services retain their own terms.
