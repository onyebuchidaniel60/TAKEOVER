# Deployment and Nimiq Pay Preparation

Date: 2026-09-12. Status: **FRONTEND DEPLOYED to Vercel; CORS pass 2 BLOCKED on Railway
token scope (dashboard fallback documented in §8).**

## 1. Live endpoints

- Backend (Railway, production): `https://takeover-api-production-1511.up.railway.app`
  - `GET /health` → 200 `{"status":"ok"}` (verified).
  - `GET /api/v1/slots?limit=1` → 200 with live DB rows (verified — DATABASE_URL is correct).
- Frontend (Vercel, production): `https://takeover-web-gamma.vercel.app` (production alias;
  deployment `https://takeover-gnyxd4jmi-uhhh2.vercel.app`, READY 2026-09-12).
  - Smoke: `GET /` → 200 TAKEOVER HTML; `/assets/*.js|css` → 200; `/favicon.svg` → 200.
  - Bundle proof: deployed main chunk contains exactly one `takeover-api-production-1511`
    hit inside `apiBaseUrl()` (`"https://takeover-api-production-1511.up.railway.app"`,
    no trailing slash) — `VITE_API_BASE_URL` baked in from the Production env var.
  - Project `uhhh2/takeover-web` is GitHub-connected (repo TAKEOVER, branch main) with
    framework `vite`, Root Directory `apps/web`, default build/output commands.
    CLI deploys MUST run from the repo root (see §8 lesson 2). The deployed JS chunk hash
    differs from a local build exactly by the baked-in `VITE_API_BASE_URL` (expected);
    the CSS hash is identical (`index-BBmUCMzo.css`).

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
   (shell exports; no dotenv dependency).
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
5. **Vercel deploy blocked in the first pass; completed in the second resume (see §9).**
   The first-pass blockers were the rejected token (fixed by rotation) and the missing
   pieces above (existing-project link, deploy-from-root, `.vercelignore`). Railway
   pass 2 (CORS) is still pending, now blocked on Railway token scope (see §9.5) —
   no longer on the Vercel URL.

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
- **Origin risk for the CSRF guard (unresolved):** `createCsrfGuard`
  (`apps/api/src/http/csrf.ts`) rejects credentialed mutations with a missing/unlisted Origin
  (403 `FORBIDDEN_ORIGIN`). If the WebView sends no Origin, or anything other than the exact
  Vercel URL, every authenticated POST/PATCH/PUT/DELETE from inside Nimiq Pay fails. The guard
  is **not weakened** and no Nimiq Pay origin is pre-added to `CORS_ORIGINS` (per the brief).
  Record the actual Origin (Railway logs show the rejected value; the
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
- **Token rotation/removal (after submission):** rotate both tokens in the Vercel/Railway
  dashboards, delete the `VERCEL_TOKEN` / `RAILWAY_TOKEN` lines from root `.env.txt`, verify with
  a key-only listing. Never commit `.env.txt` (gitignored).

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
5. Fill the `<vercel-url>` placeholder in `docs/deployment/manual-test.md`, then run the round-trip below.

## 9. Resume lessons learned 2026-09-12 (second resume — token worked)

1. The token scope is `uhhh2`; a `takeover-web` project already existed there
   (GitHub-connected, two dashboard deployments). `vercel link --yes` from `apps/web`
   created a DUPLICATE project `web` instead of linking it — removed immediately via
   `vercel remove web --yes` (zero deployments on it), then linked explicitly with
   `vercel link --yes --project takeover-web`. Always pass `--project` when a project
   already exists.
2. `takeover-web` has Root Directory `apps/web` (correct for its git-connected flow).
   A CLI deploy from `apps/web` uploads that dir as the deployment root, so the server
   fails with `The specified Root Directory "apps/web" does not exist`. Fix: deploy from
   the REPO ROOT (`vercel deploy . --prod --yes --project takeover-web`) — the payload
   then contains `apps/web`, the server build matches the working git flow, and no
   project setting changes. Do NOT clear Root Directory (it would break git deploys).
3. The CLI does NOT honor `.gitignore` for uploads: `--dry` proved root `.env.txt`
   (live secrets) plus all `dist/` output were in the 400-file payload. Fix: root
   `.vercelignore` (committed) excludes `.env*` files and `dist/` (400 → 205 files).
   Verify with `--dry` before every CLI deploy from root.
4. One transient `Error: fetch failed` AFTER a full upload left no server-side deployment
   (`vercel ls` showed only the old ones); retrying the identical command succeeded.
5. **Railway token scope BLOCKER (CORS pass 2 pending):** the `RAILWAY_TOKEN` in root
   `.env.txt` is rejected with `Unauthorized` on `variable list`, `variable set`,
   `deployment list`, `logs`, and `whoami` (singular `variable` and plural `variables`
   forms alike). It was able to `up` in the first 14a pass, but variable management is
   outside its grants as it stands — so `CORS_ORIGINS` cannot be set from the CLI.
   Dashboard fallback (human, 1 minute): Railway → `takeover-api` service → Variables →
   add `CORS_ORIGINS=https://takeover-web-gamma.vercel.app` (exact alias, no trailing
   slash, no wildcard) → the service redeploys automatically. Then re-run the preflight
   from §5c against the Vercel origin (expect 204 + exact ACAO echo + credentials, no
   wildcard) plus `/health` and `/api/v1/slots`. Pre-pass-2 state recorded 2026-09-12:
   OPTIONS from the alias origin → 404 `NOT_FOUND`, no ACAO (fail-closed, correct).
