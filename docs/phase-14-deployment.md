# Phase 14a — Deployment and Nimiq Pay Preparation

Date: 2026-09-12. Status: **PARTIAL — backend live, frontend blocked on a rejected Vercel token.**

## 1. Live endpoints

- Backend (Railway, production): `https://takeover-api-production-1511.up.railway.app`
  - `GET /health` → 200 `{"status":"ok"}` (verified).
  - `GET /api/v1/slots?limit=1` → 200 with live DB rows (verified — DATABASE_URL is correct).
- Frontend (Vercel): **not deployed.** The Vercel token in root `.env.txt` is rejected by
  `api.vercel.com` (`{"error":{"code":"not_found",...}}`, "User not found"; also via
  `vercel project list`). Per the failure protocol the Vercel path was stopped, not worked around.
  Resume steps in §8.

## 2. Deploy method used

CLI only, non-interactive, from the repo root (Railway) / `apps/web` (Vercel, blocked).

- Railway CLI 5.54.0, Vercel CLI 59.16.0 (installed globally per the brief; invoked as
  `railway.cmd` / `vercel.cmd` because PowerShell execution policy blocks the `.ps1` shims).
- Tokens loaded from `.env.txt` into per-command shell variables (same shell-export mechanism
  prior phases used for DATABASE_URL). Values never printed, never in command text for secrets
  (`--stdin` pipe), never committed.
- Railway service config: **`railway.json` at repo root** (brief's first-listed option).
  The builder is Railpack 0.39.0 (not Nixpacks). `railway.json` still applies but is deprecated
  ("Config as Code … works until 2026-12-01 — migrate to `.railway/railway.ts`"). If a future
  deploy ignores `railway.json`, migrate then; do not preemptively re-architect.
- Health check path `/health` (root, DB-independent, outside `/api/v1` so CORS/CSRF never gate it).

## 3. Production environment variables (Railway, service `takeover-api`, env `production`)

| Variable | Value / source |
|---|---|
| `NODE_ENV` | `production` |
| `CLAIM_HOLD_TTL_SECONDS` | `600` |
| `PAYMENT_REVIEW_TIMEOUT_SECONDS` | `1800` |
| `DATABASE_URL` | dev Supabase string from `.env.txt` (per brief, MVP) — set via `--stdin`, value never shown |
| `ADMIN_WALLET_ADDRESSES` | from `.env.txt` — set via `--stdin`, value never shown |
| `SESSION_SECRET` | fresh 64-hex (32 random bytes, generated in-memory, set via `--stdin`); no dev value existed or was reused |
| `CORS_ORIGINS` | **unset (pass 1)** — production allowlist is empty = fail closed |
| `NIMIQ_RPC_URL` / `NIMIQ_NETWORK` | **unset** — absent from local env, so server defaults apply (public mainnet RPC). Per brief ("same as dev"). |
| `SENTRY_DSN` | **unset** — not provided |

Verified via key-only listing (13 keys: the 6 above + 7 `RAILWAY_*`-injected). Values never listed.

## 4. Deviations from the brief (all documented, none silent)

1. **Secrets live in `.env.txt`, not `.env`.** No root `.env` exists. Same loading mechanism
   (shell exports; no dotenv dependency — the established Phase 1 policy).
2. **`railway link` / `railway add` do not work with the project token** ("Unauthorized" for
   `link` in all forms; `add` requires linked context). Resolved within the token's grants:
   `railway up --ci --project <id> --environment production --service takeover-api` created
   service `takeover-api` (id `b5cfa6c2-…`) and deployed without any link step. All later
   commands pass `-s/-e/-p` explicitly.
3. **Railpack required a root `start` script** ("No start command detected" — first deploy failed).
   Small fix per the failure protocol: root `package.json` gains
   `"start": "npm run start --workspace takeover-api"`. No product behavior change.
   Railpack used Node 24.20.0 (matches `.nvmrc`).
4. **`VITE_API_BASE_URL` did not exist anywhere** (`git log -S` over all history: zero hits; the
   client used same-origin relative `/api/…` paths, dev-proxy only). Setting the env var per
   Part 4d would have been dead config and the deployed frontend would have called `/api` on
   the Vercel origin. Small fix per the failure protocol: `apiFetch` now prefixes
   `VITE_API_BASE_URL` (trailing slash stripped; unset/blank → identical same-origin behavior).
   No API contract, state machine, auth, or payment-logic change. Covered by
   `apps/web/test/deployment-config.test.ts` (13 tests).
5. **Vercel deploy blocked** (see §1, resume in §8). Consequently there is no Vercel URL, no
   `VITE_API_BASE_URL` value set anywhere yet, and Railway pass 2 (CORS) is pending.

## 5. Nimiq Pay framing research (Part 6)

- **No CSP `frame-ancestors` or allow-framing work is required.** Per the official docs
  (https://nimiq.dev/mini-apps — "How It Works"), a mini app "run[s] in a WebView", "like a
  specialized web browser embedded within Nimiq Pay": the app URL loads as the **top-level
  document** of that WebView and Nimiq Pay **injects** `window.nimiq` / `window.nimiqPay` into it
  (confirmed in the installed SDK: `init()` only polls for the injected `window.nimiq` —
  `node_modules/@nimiq/mini-app-sdk/dist/index.js`). Nothing iframes the mini app from a Nimiq
  Pay origin, so there is no framing origin to allow on either the frontend (no CSP header is
  set at all) or the backend.
- **Reaching the app in Nimiq Pay** (for the manual script): Nimiq Pay → Mini Apps → Custom URL
  field → paste the Vercel URL (per https://www.nimiq.dev/mini-apps/faq "How do I deploy my
  mini app?" and `/mini-apps/development/load-local-mini-app`). Deeplinks also exist:
  `nimiqpay://miniapp?url=<host>` and `https://nimpay.app/miniapps/open/<host>`.
- **Origin header: officially undocumented — a known unknown.** Nimiq docs say nothing about
  what the WebView sends as `Origin` on `fetch()`. An independent integrator doc
  (PanoramicRum/nimiq-simple-faucet `docs/mini-apps-integration.md`) lists exactly this as an
  open question (their issue #121): candidates are absent/`null`, the app URL, or a
  `chrome-extension://`-style URL.
- **Origin risk for the Phase 12 CSRF guard (unresolved until 14b):** `createCsrfGuard`
  (`apps/api/src/http/csrf.ts`) rejects credentialed mutations with a missing/unlisted Origin
  (403 `FORBIDDEN_ORIGIN`). If the WebView sends no Origin, or anything other than the exact
  Vercel URL, every authenticated POST/PATCH/PUT/DELETE from inside Nimiq Pay fails. The guard
  is **not weakened** and no Nimiq Pay origin is pre-added to `CORS_ORIGINS` (per the brief).
  Phase 14b must record the actual Origin (Railway logs show the rejected value; the
  `FORBIDDEN_ORIGIN` envelope carries a requestId for correlation).
- **Cookie note (adjacent, no action):** the WebView has its own cookie jar; our prod session
  cookie is `HttpOnly; Secure; SameSite=None` (already implemented for the Vercel→Railway
  topology) and production is HTTPS-only, so `credentials: 'include'` fetches carry it.
  Troubleshooting tree item A covers the failure mode.
- **Mainnet warning:** the backend verifies against mainnet RPC by default. Nimiq Pay's hidden
  testnet mode (long-press settings 10s) + free testnet NIM exist, but a testnet payment will
  NEVER verify (tx absent on mainnet → pending → review). The round-trip must use mainnet NIM.

## 6. Diagnostic instrumentation (Part 7)

- New flag `VITE_DEBUG_PAYMENTS`, true only when exactly `'true'`; default false.
- `apps/web/src/lib/debug-payments.ts`: `isDebugPaymentsEnabled()`, gated `debugPaymentsLog()`,
  `redactIntentForLog()` (amount + data verbatim, recipient truncated, tx hash redacted),
  `redactSdkArgsForLog()` (value + data verbatim, recipient truncated).
- `PaymentPanel` logs the 4 required items (intent / SDK args / SDK return / submission body).
- Reconciliation (documented in code): "show recipient" vs "never log full wallet addresses" →
  recipients are truncated (`NQ07…0000` form); the SDK return and submission body are verbatim
  (public on-chain identifiers required by troubleshooting item B).
- Build-output proof: with the flag unset, Vite+esbuild constant-folds the check and the
  production bundle contains **zero** payment-debug code (no `payments-debug` string, no
  `VITE_DEBUG_PAYMENTS` identifier); with `VITE_DEBUG_PAYMENTS=true` the log path is present.
  Same for `VITE_API_BASE_URL` (absent when unset → same-origin; baked when set). Verified by
  experiment, then rebuilt clean.

## 7. Rollback procedure (Part 9)

- **Railway service:** `railway service delete takeover-api` (or dashboard → service → Settings →
  Delete; also `railway domain delete <domain>` removes the public URL). Deploys stop immediately.
- **Vercel:** never deployed (blocked). If a later pass deploys: `vercel remove <project> --yes`
  (or dashboard → project → Settings → Delete), which removes all deployments and env vars.
- **Production database reset** (shared Supabase per §3 — coordinate, this also wipes dev data):
  drop all tables, re-run `npm run db:migrate`, do NOT seed (`db:seed` is dev-only and stays so).
- **Token rotation/removal (after Phase 15):** rotate both tokens in the Vercel/Railway
  dashboards, delete the `VERCEL_TOKEN` / `RAILWAY_TOKEN` lines from root `.env.txt`, verify with
  a key-only listing. Never commit `.env.txt` (gitignored since Phase 2).

## 8. Resume steps (human unblock → finish 14a)

1. Provide a working Vercel token in root `.env.txt` as `VERCEL_TOKEN` (current value is rejected —
   rotate or re-issue; keep the `VITE_` prefix off).
2. `cd apps/web`, load the token into a shell var from `.env.txt`, then:
   `vercel link --yes --token <var>` (report prompts), root dir `apps/web`, preset Vite,
   build `npm run build`, output `dist`.
3. `vercel env add VITE_API_BASE_URL production` with value
   `https://takeover-api-production-1511.up.railway.app` (no trailing slash), then
   `vercel deploy --prod --yes --token <var>`; capture the `https://<project>.vercel.app` URL;
   smoke-check `curl <vercel-url>/` → app HTML.
4. Railway pass 2: set `CORS_ORIGINS` to the exact Vercel URL (no trailing slash, no wildcard),
   redeploy (`railway up --ci -p <id> -e production -s takeover-api`), run the OPTIONS preflight
   from Part 5c; on failure report headers verbatim and stop.
5. Fill the `<vercel-url>` placeholder in `docs/phase-14-manual-test.md`, then run Phase 14b.
