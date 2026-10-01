# WatchDog

**Two gold prices. Email alerts. Your computer can be off.**

WatchDog is a private gold alert app with a mobile-friendly HTML page. The cloud version runs on **Cloudflare Workers**, stores targets in **Cloudflare D1**, and checks prices with a **Cron Trigger every minute**. A small **Google Apps Script relay** sends email through your Google account.

Each person deploys their own copy with their own account, two targets, and one recipient. This repository is source code, not a shared hosted alert service.

## How it works

1. Open your deployed WatchDog URL on your phone or computer.
2. Sign in with your app password.
3. Enter exactly two prices and click **Save & arm both alerts**.
4. Cloudflare checks the gold price about every minute.
5. When a target is reached or crossed, the Gmail relay sends one email and that target disarms.

Once deployed and configured, monitoring continues with the page closed and your phone or PC switched off. Save again to rearm both targets; Pause cancels armed targets and pending emails. You can put both targets on the same side of the current price.

**This is near-real-time polling, not a tick stream.** A brief touch and reversal between checks can be missed. Feed latency, scheduler delays and email delivery add delay. The feed is gold in USD per troy ounce and may differ from your broker's XAUUSD bid/ask.

## What you need

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) with Workers and D1 access.
- A Google account permitted to deploy an Apps Script web app and send mail.
- [Node.js 22.13+](https://nodejs.org/) (Node.js 24 recommended) for the one-time deployment from your computer.

There is no required paid data API key, Firebase billing upgrade, email sender domain, or Gmail App Password for this cloud setup. Workers/D1 have free allowances, and Google Apps Script has sending/runtime quotas. Small personal use is intended to fit those allowances; availability and quotas can change. Do not enable a paid plan or evade limits to make this run. Other activity in your accounts also uses their quotas.

The Gmail relay sends via Google's MailApp after you grant it permission. It does not read your inbox. Managed Google accounts may restrict anonymous web apps or mail access; use an account where those features are permitted.

## Deploy your own cloud version

You need your computer only for setup and later code deployments. It does not need to stay on afterward.

### 1. Get the code

```sh
git clone https://github.com/0xtrvkc/watchDog.git
cd watchDog
npm ci
```

Or download **Code → Download ZIP**, extract it, and open a terminal in the folder containing `package.json`. On Windows, type `powershell` into the File Explorer address bar to open a terminal there.

Fork the repository if you want to maintain your own version. Clone your fork instead of the URL above. Do not put real passwords, relay secrets or private data in the repository.

### 2. Set up Gmail delivery

1. Open [Google Apps Script](https://script.google.com/) and create a **New project**, named `WatchDog mail relay`.
2. Replace the editor's starter code with the complete contents of [`cloud/gmail-relay.gs`](cloud/gmail-relay.gs). Save it.
3. Open **Project Settings → Script properties** and add:

   | Property | Your value |
   |---|---|
   | `RELAY_SECRET` | A unique random secret of at least **32 characters**. Keep it private; you will reuse the same value in Cloudflare. |
   | `MAIL_TO` | Your alert recipient address, for example `your-address@gmail.com`. |

4. In the editor, select **`authorizeMail`** from the function dropdown and click **Run**. Review and grant your own script the requested send-email permission. This step does not send an email.
5. Click **Deploy → New deployment → Web app**.
6. Set **Execute as: Me** and **Who has access: Anyone**, then deploy. The Worker needs access without an interactive Google sign-in; the secret in the request protects sending.
7. Copy the web app URL ending in **`/exec`**. Do not use the `/dev` testing URL.

The relay accepts email only for the configured `MAIL_TO`, verifies `RELAY_SECRET`, and remembers recently sent alert IDs to suppress retries. Do not publish the secret or make this an open mail relay. If your account does not permit the “Anyone” deployment, this relay cannot be used under that account's policy.

### 3. Create the Cloudflare database

From the WatchDog folder:

```sh
npx wrangler login
npx wrangler d1 create watchdog
```

Login opens Cloudflare in your browser. After database creation, copy the returned **`database_id`**.

Open [`wrangler.jsonc`](wrangler.jsonc) in a text editor and replace:

```json
"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"
```

with your actual database ID. Keep `binding` as **`DB`**, `database_name` as **`watchdog`**, and `migrations_dir` as **`migrations`**. Keep the rest of the configuration.

If `watchdog` is already the name of a database in your account, use another name for creation and set that same name in `wrangler.jsonc`. The `DB` binding must stay unchanged.

Initialise the remote database:

```sh
npm run db:remote
```

Confirm the migration when prompted. It creates the single state record used for your two alerts.

### 4. Deploy the app and configure its secrets

```sh
npm run deploy
```

Wrangler prints your HTTPS address, typically:

```text
https://watchdog-gold-alerts.YOUR-SUBDOMAIN.workers.dev
```

The page can load now, but signing in and sending email require the following secrets. Run each command and enter its value at the prompt:

```sh
npx wrangler secret put APP_PASSWORD
npx wrangler secret put MAIL_TO
npx wrangler secret put EMAIL_WEBHOOK_URL
npx wrangler secret put EMAIL_WEBHOOK_SECRET
```

| Cloudflare secret | Value to enter |
|---|---|
| `APP_PASSWORD` | Your own random app login password, at least 16 characters. Use a different value from the relay secret. |
| `MAIL_TO` | The **same recipient address** you set in Google Script Properties. |
| `EMAIL_WEBHOOK_URL` | The deployed Google web app URL ending in `/exec`. |
| `EMAIL_WEBHOOK_SECRET` | The **same secret** you set as `RELAY_SECRET` in Google Script Properties. |

Secrets remain on the backend. The public HTML page does not receive your app password or relay secret. You can also manage these values in your Worker's Cloudflare **Settings → Variables and Secrets**.

### 5. Verify the schedule and email

1. Open your deployed HTTPS app URL on your phone or computer.
2. Sign in with `APP_PASSWORD`.
3. Click **Test email** and check inbox/spam.
4. In Cloudflare, open the Worker and confirm its **Cron Trigger** is `* * * * *` (every minute).
5. Wait for a fresh quote. New/changed Cron Triggers can take time to propagate; Cloudflare documents up to 15 minutes.
6. Enter your two prices and click **Save & arm both alerts**.

Now your PC can be switched off. Do not delete the Worker, its Cron Trigger, the D1 database or the Google relay deployment while you want monitoring to continue.

## Target behaviour

| Target relative to the quote when you save | Trigger |
|---|---|
| Above current price | First fresh observed quote at or above the target |
| Below current price | First fresh observed quote at or below the target |

Two different targets are required. A target exactly equal to the current quote is rejected. A jump over a target can trigger; exact numerical equality is not required.

Each target sends once, then disarms. Saving reinitialises **both** targets using the latest quote as their baseline. An email pending delivery must be cancelled with Pause before replacing targets.

## Reliability and limits

- Cloudflare runs the checks, not GitHub Actions or your browser. The schedule is every minute, but execution and external services are not guaranteed to be instantaneous.
- One shared provider request is made per scheduled check when due. Opening more tabs does not increase provider requests.
- The monitor honours the provider's 30-second minimum caching guidance, longer cache headers, `Retry-After`, and error backoff. Outages can increase the interval to 15 minutes or longer when the provider requests it.
- Quotes more than 120 seconds old, more than 10 seconds in the future, or out of order do not trigger alerts.
- Targets, triggered events, pending messages and accepted-email status persist in D1. The cloud version does not import the local Python `data/state.json`; set your two prices again after switching.
- A database lease prevents overlapping scheduled runs. Optimistic version checks prevent concurrent page/scheduler updates from overwriting each other.
- Failed messages retry with increasing delays, up to 10 attempts and within six hours. The original message/recipient is preserved for retries.
- The Gmail relay suppresses known duplicate IDs, keeping up to 200 IDs for seven days. Google MailApp sending and the retry ledger are not one atomic transaction: a rare crash after sending but before recording can still cause a duplicate. Inbox placement is not guaranteed.
- Pause cancels queued events. A request already in flight may still deliver afterward.
- Sessions expire after a day; changing `APP_PASSWORD` invalidates existing sessions. Monitoring does not require an active browser login.
- Login attempts and email tests are rate-limited across instances. Protect your passwords and use this as a private single-user app.
- Google account quotas apply to all relevant activity in that account. Failed quota/permission checks appear as pending or failed email status; the app does not bypass them.

## Troubleshooting

| Symptom | Check |
|---|---|
| App says configure password | Set `APP_PASSWORD` as a Worker secret; use at least 16 characters and replace all example values. |
| Cloud setup error | Check the D1 `database_id`, the `DB` binding and whether `npm run db:remote` succeeded. |
| Waiting for a quote | Confirm the Cron Trigger and allow initial propagation time; check the source's freshness. |
| Cloud checks not confirmed recently | Check Worker scheduled execution logs, quotas, database access and the Cron Trigger. |
| Email not configured | Set `MAIL_TO`, `EMAIL_WEBHOOK_URL` and a 32+ character `EMAIL_WEBHOOK_SECRET`. |
| Relay secret/recipient does not match | Match both values exactly between Google Script Properties and Cloudflare secrets. |
| Relay does not return JSON | Use `/exec`, Execute as Me, and Anyone access. Recheck whether your Google account permits this deployment. |
| Relay failed | Re-run `authorizeMail` to check permission, inspect Apps Script Executions, and check Google's remaining mail quota. |
| Test accepted but inbox empty | Check spam/junk and sender/account restrictions. Acceptance is not a guarantee of inbox placement. |
| Email failed | Fix the relay, verify Test email, then save targets again to rearm. |
| Newly edited relay code not active | In Apps Script, edit the deployment, select a **new version**, and deploy. Merely saving editor code does not update `/exec`. |

Do not paste secrets into public issues. When reporting a problem, share the error and whether it came from WatchDog, Cloudflare or Apps Script; remove passwords, cookies, relay URLs and personal addresses from screenshots/logs.

## Updating and local development

After pulling source updates:

```sh
npm ci
npm test
npm run check
npm run db:remote
npm run deploy
```

Migrations preserve existing state unless an individual migration explicitly changes it. Updating Worker code does not update your separate Google relay: follow the new-version deployment step above if `gmail-relay.gs` changed. Keep your existing D1 ID and Worker secrets.

For cloud development on your computer:

```sh
npm run db:local
```

Copy `.dev.vars.example` to **`.dev.vars`**, enter your own development secrets, then:

```sh
npm run dev
```

The console prints a local app address. A local scheduled invocation can be triggered manually at `http://localhost:8787/__scheduled` (use the port printed by Wrangler). **Local mode does not run unattended cloud Cron Triggers**, and Test email/a scheduled crossing can send real mail if you supplied a real relay. Local D1 state is separate from the remote database.

Automated tests use a SQLite-backed D1 adapter and mocked email/provider responses; they do not send real emails:

```sh
npm test
```

The original Python/SMTP version remains available for people who prefer an always-on computer or server. See [local Python setup](docs/LOCAL_SETUP.md). Its `.env` and SMTP settings are separate from the cloud secrets; do not run both monitors for the same targets unless you want alerts from both.

## Project files

| File | Purpose |
|---|---|
| `cloud/worker.js` | Private cloud API, authentication, scheduled monitoring and Gmail relay calls |
| `cloud/gmail-relay.gs` | Google Apps Script email relay |
| `migrations/0001_state.sql` | D1 saved-state schema |
| `wrangler.jsonc` | Worker, D1, static assets and one-minute Cron Trigger configuration |
| `public/` | Phone-friendly two-target HTML interface |
| `cloud/worker.test.js` | Cloud behaviour/API/relay tests |
| `server.py`, `tests/test_alerts.py` | Optional local Python backend and tests |
| `docs/LOCAL_SETUP.md` | Local Python/Docker instructions |

## Sources and licence

- [Gold API documentation](https://gold-api.com/docs), [cache guidance](https://gold-api.com/llms.txt), and [terms](https://gold-api.com/terms).
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
- [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web), [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app), and [quotas](https://developers.google.com/apps-script/guides/services/quotas).

The provider's published terms permit app use and prohibit abuse. References were reviewed on **2026-10-01**; terms, free allowances and service availability can change. This project does not certify the provider's upstream data licensing.

[xdec/gold-price-api](https://github.com/xdec/gold-price-api), [lizhuoxi/XAUUSD-Price-Realtime](https://github.com/lizhuoxi/XAUUSD-Price-Realtime), and [KlodCripta/xauwatch](https://github.com/KlodCripta/xauwatch) informed the initial review; no code was copied from them.

WatchDog is available under the [MIT License](LICENSE). Data, hosting and email services retain their own terms.
