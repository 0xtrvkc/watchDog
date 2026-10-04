# Jev upgrade — Two-target natural-language preview

Sign in to the existing app, then describe exactly two distinct positive USD target prices and explicit directions, with no other numbers. Commas and up to two decimals are supported. Preview both targets, then fill both existing inputs. The requested directions must agree with the existing side-of-current-price arming rule; conflicting, ambiguous or low-confidence directions are rejected. Filling fields does not arm alerts or send email. Save & arm both alerts remains the only arming action; price crossing, one-shot disarming, scheduler leases and Gmail delivery remain deterministic.

## Use

1. Open the new feature panel in its intended app view.
2. Enter a request and use **Preview input** to inspect exactly what will be sent.
3. Select the per-request consent checkbox, then run the check.
4. Review the result. Where available, a separate Open/Fill/Show button performs the bounded action.

The feature works only after a deployed endpoint and server-side TypeSafe API key are configured. Source integration and mocked tests do **not** establish live model accuracy. Without configuration, all existing app workflows remain available.

## Connect

### Existing WatchDog Worker

The app uses the existing same-origin `/api/jev` route and its existing signed-in session. No separate feature token or endpoint entry is required. Existing sessions, D1 targets, Cron Trigger and email relay remain in place.

In Cloudflare Dashboard, open the existing Worker → Settings → Variables and Secrets. Add `TYPESAFE_API_KEY` as a **secret**, optionally add `JEV_MODEL` (default `jev-latest`), and deploy the updated repository. The root `wrangler.jsonc` now supplies the optional feature's rate-limit binding. Existing WatchDog secrets must remain configured. With no TypeSafe secret, only this optional feature returns a clear configuration error.

The optional local Python server does not implement the Jev route; use the Cloudflare version for this feature. `jev/wrangler.jsonc` is available for endpoint-only development, but the production app uses its existing Worker and session authentication.

## What is checked

- Server-owned typed questions; clients cannot supply arbitrary prompts, model names or questions.
- Explicit origins, private feature token or existing WatchDog session, bounded streamed input (60 KB), fixed provider URL and rate-limit binding.
- Complete response shape, allowed options, finite confidence, valid distributions and score consistency.
- Choice confidence below 0.8 produces review; this is a conservative starting policy, **not a calibrated accuracy guarantee**. Relevance rankings can still show clearly labeled possible matches.
- Source text and selected excerpts are displayed as text, not executable HTML.
- Preview and inference do not mutate trading calculations, financial settings or external records.
- Session-only response cache for ten unchanged requests; sensitive text is not written to localStorage. Context changes clear results/cache. Requests are cancellable; expired responses cannot repopulate a cleared result.
- Timeouts, overload, malformed responses and configuration errors restore the Run control and leave existing workflows usable.

## Tests and live evaluation

```sh
node --test tests/jev.test.mjs
# With Playwright and Chromium installed:
node tests/jev-browser.cjs
# Only after explicitly configuring TYPESAFE_API_KEY in your local environment:
node jev/live-check.mjs
```

`tests/jev.test.mjs` uses synthetic provider responses to verify the boundary and domain behavior. `tests/jev-browser.cjs` loads the actual application in Chromium at desktop and mobile widths, blocks unrelated external network requests, supplies synthetic statements/vault data where needed, and mocks Jev responses. It checks consent, preview, actions, session caching, failures, cancellation and layout. It does not log into your real Firebase account, send real email or prove TypeSafe semantic quality.

The GitHub Actions **Jev integration checks** workflow runs the boundary suite and real Chromium checks on PRs and `main`. Existing repository checks remain enabled.

`jev/live-check.mjs` evaluates a small synthetic example against the actual provider and validates its response shape. It never uses your private clipboard, statement or portfolio. Before relying on classifications, build labeled representative examples in your languages and domain, measure errors, and tune questions/thresholds. Pin a tested `JEV_MODEL` version when reproducibility matters.

Reference: [TypeSafe API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [Confidence](https://docs.typesafe.ai/confidence).
