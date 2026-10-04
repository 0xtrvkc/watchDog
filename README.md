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
- A [GitHub account](https://github.com/signup) to fork this repository and connect it to Cloudflare.

**The recommended setup uses only your browser.** No terminal, GitHub Desktop, Node.js installation or always-on computer is needed. Cloudflare installs dependencies and deploys the app on its own infrastructure. Node.js 22.13+ (24 recommended) is needed only for the optional terminal route below.

There is no required paid data API key, Firebase billing upgrade, email sender domain, or Gmail App Password for this cloud setup. Workers/D1 have free allowances, and Google Apps Script has sending/runtime quotas. Small personal use is intended to fit those allowances; availability and quotas can change. Do not enable a paid plan or evade limits to make this run. Other activity in your accounts also uses their quotas.

The Gmail relay sends via Google's MailApp after you grant it permission. It does not read your inbox. Managed Google accounts may restrict anonymous web apps or mail access; use an account where those features are permitted.

## Browser-only setup (recommended)

Use your own GitHub, Cloudflare and Google accounts. Everything below happens on websites; your computer or phone does not run the monitor.

### 1. Make your own copy on GitHub

1. Sign in to GitHub and open [this repository](https://github.com/0xtrvkc/watchDog).
2. Click **Fork**, choose your account as the owner, then **Create fork**.
3. Work in your own fork for the remaining steps.

You do not need to clone or download the repository. If you already own the repository you are configuring, use that copy directly.

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

### 3. Create and initialise your Cloudflare database

Creating a database gives you an empty container. The SQL below creates the table inside it.

1. Sign in to [Cloudflare](https://dash.cloudflare.com/).
2. Open **Storage & databases → D1 SQL Database**.
3. Click **Create Database**, name it **watchdog**, then create it.
4. Open the new database's **Overview**. Copy its **Database ID**: the long identifier with hyphens beside the copy button. This is the value for `database_id`, not a password or relay secret.
5. In your GitHub fork, open [`wrangler.jsonc`](wrangler.jsonc) and click the **pencil / Edit this file** button.
6. Replace the existing `database_id` value with **your own** ID. Your fork may contain the original owner's ID rather than placeholder text; replace it either way.

The database entry should look like this, with your actual ID in place of the example text:

```json
"d1_databases": [{
  "binding": "DB",
  "database_name": "watchdog",
  "database_id": "PASTE-YOUR-OWN-DATABASE-ID-HERE",
  "migrations_dir": "migrations"
}]
```

Keep `binding` as **DB**, keep the other configuration, and click **Commit changes** to save to your fork's `main` branch. If you chose a different database name, use that same name in `database_name`.

7. Return to your Cloudflare D1 database and open the **Console** tab beside Overview.
8. Paste this first command into the input and click **Execute**:

```sql
CREATE TABLE IF NOT EXISTS monitor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_id TEXT NOT NULL DEFAULT ''
);
```

9. Replace the input with this second command and click **Execute** again:

```sql
INSERT OR IGNORE INTO monitor (id) VALUES (1);
```

Both should report **This query successfully executed**. These commands match [`migrations/0001_state.sql`](migrations/0001_state.sql) and are safe to repeat. You do not need to create another database.

### 4. Deploy directly from GitHub

1. In Cloudflare, open **Compute → Workers & Pages**.
2. Click **Create application → Import a repository → Get started**.
3. Connect your GitHub account if prompted and allow Cloudflare access to your WatchDog fork.
4. Select your fork, then use these settings:

| Setting | Value |
|---|---|
| Project name | `watchdog-gold-alerts` |
| Production branch, if shown | `main` |
| Build command | Leave empty |
| Deploy command | `npx wrangler deploy` |
| Enable Preview builds | Off for initial setup |
| Protect with Cloudflare Access | Off for this setup; the app has its own password |
| Root directory, if shown | Repository root (default) |

**Project name must match `name` in `wrangler.jsonc`.** If Cloudflare suggests `watchdog`, change it to `watchdog-gold-alerts`.

5. Click **Deploy**. Cloudflare downloads the repository, installs the dependencies, and runs the deployment command.
6. Wait for **Success: Build completed**. The log should show `env.DB (watchdog)`, `env.ASSETS`, and `schedule: * * * * *`.
7. Copy the HTTPS app address, typically:

```text
https://watchdog-gold-alerts.YOUR-SUBDOMAIN.workers.dev
```

A successful build deploys the app, but login and email still need the next step. An informational Preview URLs warning is separate from the Preview builds toggle and does not mean deployment failed.

### 5. Add the app password and email settings

Open **Workers & Pages → watchdog-gold-alerts → Settings → Variables and Secrets → Add**.

Use the Worker's runtime **Variables and Secrets**, rather than environment variables under **Builds**. Build-only values are not available to the running app.

If the dialog offers environment selection, select **Production**. Add these four entries with the exact names below; choose **Secret** (or tick the Secret checkbox) for each:

| Variable name | Your value |
|---|---|
| `APP_PASSWORD` | A unique app login password, at least **16 characters**. Choose your own; it is not your Google or Cloudflare password. |
| `MAIL_TO` | The **same recipient address** as Apps Script's `MAIL_TO`. |
| `EMAIL_WEBHOOK_URL` | The full deployed Apps Script web app URL ending in **/exec**. |
| `EMAIL_WEBHOOK_SECRET` | The **exact same value** as Apps Script's `RELAY_SECRET`, at least **32 characters**. |

**Where do I get RELAY_SECRET?** You create it yourself, preferably using your password manager's random-password generator. Google and Cloudflare do not issue it. Put the same value in Google Script Properties as `RELAY_SECRET` and in Cloudflare as `EMAIL_WEBHOOK_SECRET`. Use a different value for `APP_PASSWORD`.

Click **Add variables and deploy** or **Deploy**, depending on the dialog. Enter real values only in these account settings, never in GitHub source code.

### 6. Verify the schedule and email

1. Open your deployed HTTPS app URL on your phone or computer.
2. Sign in with `APP_PASSWORD`.
3. Click **Test email** and check inbox/spam.
4. In Cloudflare, open the Worker and confirm its **Cron Trigger** is `* * * * *` (every minute).
5. Wait for a fresh quote. New/changed Cron Triggers can take time to propagate; Cloudflare documents up to 15 minutes.
6. Enter your two prices and click **Save & arm both alerts**.

Now your PC can be switched off. Do not delete the Worker, its Cron Trigger, the D1 database or the Google relay deployment while you want monitoring to continue.


## Terminal setup (optional)

Use this route if you prefer deploying from your own computer. Install [Node.js 22.13+](https://nodejs.org/en/download) (24 recommended), then open a terminal in your project folder. Node.js 18 is too old for this project.

### 1. Download the code

Clone your fork:

```sh
git clone https://github.com/YOUR-USERNAME/watchDog.git
cd watchDog
npm ci
```

Alternatively download **Code → Download ZIP**, extract it, and open a terminal in the folder containing `package.json`. GitHub Desktop users can clone the repository, select it, then use **Repository → Open in Command Prompt** on Windows. If it is already cloned, fetch/pull the latest changes.

### 2. Prepare email and the database

Follow **Set up Gmail delivery** above, then:

```sh
npx wrangler login
npx wrangler d1 create watchdog
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing any existing ID. Keep the binding **DB** and set the matching database name.

If you already created your database through the dashboard, skip `d1 create` and use that database's ID.

```sh
npm run db:remote
```

Confirm the migration prompt. The initial migration safely handles a table already created through the browser.

### 3. Deploy and add secrets

```sh
npm run deploy
npx wrangler secret put APP_PASSWORD
npx wrangler secret put MAIL_TO
npx wrangler secret put EMAIL_WEBHOOK_URL
npx wrangler secret put EMAIL_WEBHOOK_SECRET
```

Enter the values from the browser setup's secrets table at each prompt. Open the printed HTTPS address and follow **Verify the schedule and email** above.

Your computer is needed only while running setup or updates. Cloud monitoring continues after you close it.

## Target behaviour

| Target relative to the quote when you save | Trigger |
|---|---|
| Above current price | First fresh observed quote at or above the target |
| Below current price | First fresh observed quote at or below the target |

Two different targets are required. A target exactly equal to the current quote is rejected. A jump over a target can trigger; exact numerical equality is not required.

Each target sends once, then disarms. Crossing back over it does not send another email, and crossing it again later does not automatically rearm it. Saving reinitialises **both** targets using the latest quote as their baseline. An email pending delivery must be cancelled with Pause before replacing targets.

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
| Cloud setup error / no such table: monitor | Check your own D1 `database_id` and the `DB` binding. Run both SQL commands in the browser setup, or apply the migration with `npm run db:remote`. |
| Worker name mismatch during build | Set the Cloudflare project name to `watchdog-gold-alerts`, matching `name` in `wrangler.jsonc`. |
| Secrets saved but app still says not configured | Add them in the Worker's runtime Settings → Variables and Secrets, select Production, and deploy the changes; Build settings alone are insufficient. |
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

### Browser updates

Commit code changes to the connected production branch of your fork. Cloudflare's Git integration automatically builds and deploys them; check its deployment logs for success. To bring in upstream changes, use GitHub's **Sync fork** flow and review them before updating your branch. Preserve **your own D1 ID** in `wrangler.jsonc` and the project name matching your Worker.

If a future update adds a database migration, run the newly required SQL from that migration in the D1 Console according to its instructions. The browser setup above applies only the initial schema; deploying code alone does not apply migrations. Do not blindly rerun destructive SQL.

If `cloud/gmail-relay.gs` changes, update the Apps Script code, then edit its deployment, select a **new version**, and deploy. Saving editor code alone does not update the live `/exec` relay. Your Worker secrets stay in Cloudflare.

### Terminal updates and development

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
- [Cloudflare Git deployment](https://developers.cloudflare.com/workers/ci-cd/builds/), [D1 setup](https://developers.cloudflare.com/d1/get-started/), and [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
- [Google Apps Script web apps](https://developers.google.com/apps-script/guides/web), [MailApp](https://developers.google.com/apps-script/reference/mail/mail-app), and [quotas](https://developers.google.com/apps-script/guides/services/quotas).

The provider's published terms permit app use and prohibit abuse. References were reviewed on **2026-10-01**; terms, free allowances and service availability can change. This project does not certify the provider's upstream data licensing.

[xdec/gold-price-api](https://github.com/xdec/gold-price-api), [lizhuoxi/XAUUSD-Price-Realtime](https://github.com/lizhuoxi/XAUUSD-Price-Realtime), and [KlodCripta/xauwatch](https://github.com/KlodCripta/xauwatch) informed the initial review; no code was copied from them.

WatchDog is available under the [MIT License](LICENSE). Data, hosting and email services retain their own terms.
