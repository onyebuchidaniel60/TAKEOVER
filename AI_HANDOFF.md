# TAKEOVER — AI Handoff

Status: Pre-implementation
Date: 2026-09-11

## Project

TAKEOVER is a Nimiq Pay Mini App for the last-minute marketplace of released/scarce capacity.

Core loop:

```text
Provider publishes slot
      ↓
Buyer discovers slot
      ↓
Buyer claims/holds slot
      ↓
Buyer pays exact NIM amount via Nimiq Pay
      ↓
Backend verifies transaction on-chain
      ↓
Claim becomes PAID
      ↓
Provider sees paid claim / buyer sees confirmation
```

## Current status

Product design, business logic, architecture, security model, data model, API requirements, UX structure, and phased implementation plan have been completed before implementation.

No application implementation should be assumed complete merely because a starter scaffold exists.

## Important product decisions

- MVP is provider-created capacity, not arbitrary consumer reservation transfer.
- NIM-only payments for MVP.
- Direct provider payout, no escrow.
- Backend is authoritative for payment verification.
- No AI in MVP.
- No calendar integrations.
- No ratings/reputation.
- No fiat payments.
- Published commercial fields are immutable.
- Inventory claims are protected with DB transactions and uniqueness constraints.

## Fixed stack

React + TypeScript + Vite + Tailwind + Nimiq Mini App SDK

Fastify + TypeScript + Zod

PostgreSQL + Drizzle, hosted on Supabase

Vercel frontend, Railway API

## Critical architecture invariants

1. Browser cannot declare a payment successful.
2. Browser cannot choose the payout recipient for an already-issued payment intent.
3. Browser cannot change slot ownership.
4. Browser cannot set admin role.
5. Claiming the same final unit is concurrency-safe.
6. Replaying an auth challenge fails.
7. Replaying a verified transaction against a second claim fails.
8. All protected resources are authorized server-side.
9. Secrets remain server-only.
10. Payment verification is deterministic and independent of LLMs.

## Current phase

**Phase 14a PARTIAL (2026-09-12) — backend live on Railway, frontend BLOCKED on a rejected
Vercel token. Do NOT start Phase 14b (no reachable frontend) or Phase 14c. Resume: §8 of
`docs/phase-14-deployment.md` (working Vercel token → link → env → deploy → CORS pass 2).
Resume attempted 2026-09-12: the rotated token is rejected identically — see
"Phase 14a resume attempt" below. Still blocked on human Vercel account/team diagnosis.**
(Second resume 2026-09-12: a further-rotated token WORKED — frontend deployed, see
"Phase 14a second resume" below. CORS pass 2 now blocked on Railway token scope.)

## Phase 14a second resume — frontend DEPLOYED, CORS pass 2 blocked (2026-09-12)

The re-sent resume prompt carried a further-rotated `VERCEL_TOKEN` that WORKS
(scope `uhhh2`). §8 completed except CORS pass 2, which is blocked on Railway token
scope (dashboard fallback documented). No product/auth/payment/schema changes, no new
dependencies (except the `.vercelignore` upload filter — deployment config, not a code
dependency), debug flag untouched, tokens stay in `.env.txt` per the Phase 15 rule.

What happened (token/secret values never printed):

- `vercel project list` → exit 0; pre-existing project `takeover-web`
  (`https://takeover-web-gamma.vercel.app`, two dashboard deployments by
  `onyebuchidaniel60-1034`). `vercel link --yes` created a DUPLICATE project `web` —
  removed immediately (`vercel remove web --yes`, zero deployments on it), then linked
  explicitly (`--project takeover-web`). Stray `apps/web/.gitignore` + `.env.local`
  (OIDC only) deleted; `.vercel/` link dir kept (gitignored).
- `vercel env ls` → empty, so the old production build had NO `VITE_API_BASE_URL`.
  Added `VITE_API_BASE_URL=https://takeover-api-production-1511.up.railway.app`
  (Production, no trailing slash; value piped via stdin).
- First `deploy --prod` from `apps/web` failed (plus one transient `fetch failed` with
  no server-side deployment left behind): `The specified Root Directory "apps/web" does
  not exist` — the project's git-flow Root Directory conflicts with an `apps/web`
  payload. Fixed by deploying from the REPO ROOT (payload contains `apps/web`; no
  project setting touched, git flow preserved).
- `--dry` caught a REAL secret leak before it happened: the CLI ignores `.gitignore`,
  so root `.env.txt` + all `dist/` were in the 400-file payload. New committed root
  `.vercelignore` excludes `.env*`, `dist/`, logs (400 → 205 files, `.env.txt` gone).
- Deploy `dpl_GqSP4HNpDY1LiqFFSNMJ6F2c13se` → READY, production alias
  `https://takeover-web-gamma.vercel.app`. Smoke: `GET /` → 200 TAKEOVER HTML;
  both assets → 200; favicon → 200. Bundle proof: deployed chunk has exactly one
  Railway-host hit inside `apiBaseUrl()`, zero token-name hits.
- CORS pass 2 BLOCKED: `RAILWAY_TOKEN` → `Unauthorized` on `variable list/set`,
  `deployment list`, `logs`, `whoami`. `CORS_ORIGINS` still empty (fail-closed);
  preflight from the alias origin → 404 + no ACAO (correct before-state).
  Human fallback: set `CORS_ORIGINS=https://takeover-web-gamma.vercel.app` in the
  Railway dashboard (auto-redeploys), then re-run the allowlisted preflight check.
- Battery: typecheck clean; lint clean; tests 311 api + 96 web + 1 shared pass;
  build clean; fresh-dist leak audit 0 hits across the board.
- `docs/phase-14-manual-test.md` placeholder filled with the production alias.

```text
CURRENT PHASE: Phase 14a nearly complete — frontend live, CORS pass 2 pending (Railway token scope)
COMPLETED: Vercel deploy + smoke + bundle proof + .vercelignore + manual-test URL + full battery
TESTS RUN: typecheck clean; lint clean; tests 311 api + 96 web + 1 shared pass; build clean; alias / → 200 + assets 200; deployed chunk 1 Railway-host hit / 0 token hits; preflight 404 + no ACAO (fail-closed before-state); dist audit 0 hits
RESULT: partial — human sets CORS_ORIGINS in Railway dashboard (or grants variable scope), then allowlisted-preflight re-check
KNOWN ISSUES: Railway CLI token Unauthorized for variable/log/deployment reads (up-scope from first pass untested, redeploy pointless without the var); railway.json deprecation (until 2026-12-01); dead takeover:payments-debug CSS rule (cosmetic)
SECURITY NOTES: .env.txt nearly uploaded via CLI (caught by --dry, fixed by .vercelignore); tokens/secrets never printed or committed; CSRF guard untouched; CORS still fail-closed
FILES CHANGED: .vercelignore (new), docs/phase-14-deployment.md (§1/§4/§9), docs/phase-14-manual-test.md (URL placeholder), AI_HANDOFF.md (this checkpoint)
GIT COMMIT: feat: deploy frontend to Vercel and harden CLI upload filter
NEXT TASK: human sets CORS_ORIGINS → allowlisted preflight re-check → Phase 14b round-trip (do NOT start automatically)
BLOCKED BY: Railway variable scope (dashboard fallback ready)
```

## Phase 14a resume attempt — stopped, Vercel token rejected again (2026-09-12)

Resume of §8 stopped per the failure protocol at the first step: the rotated
`VERCEL_TOKEN` in root `.env.txt` (present, 60 chars) is rejected identically to the
Phase 14a token. No deployment variation attempted, no token inferred from any other
source, no new Vercel project created, no code/config changed.

Evidence (token values never printed, loaded from `.env.txt` into a shell var only):

- `vercel.cmd project list --token $env:VERCEL_TOKEN` → `Error: User not found.`,
  exit 1 (Vercel CLI 59.16.0; the failure exposes no team/account context).
- Direct `GET https://api.vercel.com/v2/user` with the same bearer token → 404
  `{"error":{"code":"not_found","message":"User not found."}}` — agrees with the CLI.
- Live backend re-verified this session: `GET /health` → 200 `{"status":"ok"}`;
  `GET /api/v1/slots?limit=1` → 200 with live rows. Railway pass 1 (empty
  `CORS_ORIGINS`, fail-closed) untouched.
- Fail-closed spot check: OPTIONS preflight with an unlisted Origin → 404 `NOT_FOUND`
  envelope, no `Access-Control-Allow-Origin` echo — correct pass-1 behavior (the 404 comes
  from `@fastify/cors` v11 calling `callNotFound()` when the origin callback returns
  false; confirmed against the installed source). Allowlisted-origin echo remains
  untestable without a Vercel URL.
- Verification battery (code/config unchanged): `run typecheck` clean, exit 0;
  `run lint` clean, exit 0; `run test` green — api 311 (27 files) + web 96 (11 files) +
  shared 1, exit 0 (identical counts to Phase 14a); `run build` clean, exit 0.
- Token-leak audit on the fresh `dist` (33 files, count-only): 0 token-prefix hits,
  0 full-token hits, 0 `VITE_*TOKEN` names, 0 secret key names, 0 secret values.
  Observation (no action taken — out of resume scope): the literal `payments-debug`
  appears once in the CSS bundle because Tailwind scans `[takeover:payments-debug]`
  (the debug log prefix in `apps/web/src/lib/debug-payments.ts:18`) as an
  arbitrary-value class candidate and emits a dead rule. Zero hits in any JS chunk and
  zero `VITE_DEBUG_PAYMENTS` hits, so the Phase 14a tree-shaking claim holds for code;
  refining that claim to "zero in JS; one dead CSS rule" is a Phase 15-or-later nicety,
  not a resume blocker. Locked decisions honored throughout: CSRF guard untouched,
  no payment/auth/schema changes, no new dependencies, debug flag not enabled.

```text
CURRENT PHASE: Phase 14a still partial — backend live, frontend blocked (second Vercel token rejected)
COMPLETED: resume evidence (CLI + direct-API rejection), backend liveness, fail-closed preflight spot check, full verification battery
TESTS RUN: typecheck clean; lint clean; tests 311 api + 96 web + 1 shared pass; build clean; /health 200; /slots 200 live rows; preflight 404 + no ACAO (fail-closed); dist audit 0 secret hits
RESULT: BLOCKED — awaiting human Vercel account/team diagnosis (resume docs/phase-14-deployment.md §8)
KNOWN ISSUES: Vercel token rejected ("User not found", CLI + api.vercel.com agree); CORS pass 2 + Vercel smoke + allowlisted preflight pending behind it; railway.json deprecation (functional until 2026-12-01); dead takeover:payments-debug CSS rule (cosmetic, out of scope)
SECURITY NOTES: tokens/secrets never printed or committed; guard NOT weakened; CORS still fail-closed (empty allowlist)
FILES CHANGED: AI_HANDOFF.md (this checkpoint only)
GIT COMMIT: chore: phase 14a resume — vercel token rejected again
NEXT TASK: human diagnoses Vercel account/team ownership → finish 14a resume → Phase 14b round-trip (do NOT start automatically)
BLOCKED BY: working Vercel token
```

## Phase 14a implementation results — partial, blocked (2026-09-12)

Backend deployed and healthy; frontend code prepared (Part 7 done, `VITE_API_BASE_URL` wired)
but NOT deployed — `VERCEL_TOKEN` is rejected by `api.vercel.com` ("User not found"), so
`vercel link` / `env add` / `deploy` are impossible. No Nimiq Pay round-trip run (14b, human).
No product-behavior or architecture change. Full details: `docs/phase-14-deployment.md`;
human script: `docs/phase-14-manual-test.md` (Vercel URL placeholder to fill after unblock).

What changed (code):

- `apps/web/src/lib/api.ts` — `apiBaseUrl()` + prefix in `apiFetch`. SMALL FIX (failure
  protocol): `VITE_API_BASE_URL` never existed (`git log -S`: zero hits in all history); without
  wiring, Part 4d's env var would be dead config and the Vercel app would call `/api` on its own
  origin. Unset/blank → byte-identical same-origin behavior. No contract/state/auth change.
- `apps/web/src/lib/debug-payments.ts` (new) + 4 call sites in `PaymentPanel.tsx` (Part 7):
  intent (amount/data verbatim, recipient truncated, txHash redacted), SDK args (value/data
  verbatim, recipient truncated), SDK return verbatim, submission body verbatim. Reconciliation
  (in-code): "show recipient" vs "never full wallet addresses" → truncated display form; tx
  hashes are public chain identifiers required by troubleshooting item B.
- `apps/web/test/deployment-config.test.ts` (new, 13 tests): base-URL set/unset/slash, dev vs
  prod fetch prefix, flag default-false + exact-'true' + gated logging, redaction (no full
  address in output).
- `package.json` — root `"start": "npm run start --workspace takeover-api"`. SMALL FIX: Railpack
  0.39.0 (the actual builder, not Nixpacks) failed the first deploy with "No start command
  detected". No product change.
- `railway.json` (new, repo root): NIXPACKS builder, workspace build/start, `/health` check.
  CLI warns Config-as-Code is deprecated (works until 2026-12-01); migrate only if ignored.
- `docs/phase-14-deployment.md` + `docs/phase-14-manual-test.md` (new, required by the brief).

Deployment (Railway, CLI 5.54.0, explicit `-s/-e/-p` flags — `link`/`add` reject the project
token with Unauthorized, so no linked context exists; `up` with flags created and deployed):

- Service `takeover-api` (id `b5cfa6c2-…`), env `production`, region sfo, Node 24.20.0.
- URL: `https://takeover-api-production-1511.up.railway.app` (service domain, ACTIVE).
- Vars: `NODE_ENV=production`, `CLAIM_HOLD_TTL_SECONDS=600`,
  `PAYMENT_REVIEW_TIMEOUT_SECONDS=1800`, `DATABASE_URL` (dev Supabase, per brief),
  `ADMIN_WALLET_ADDRESSES` (from `.env.txt`), `SESSION_SECRET` (fresh 64-hex, no dev reuse) —
  secrets via `--stdin`, values never shown; key-only listing verified (6 + 7 `RAILWAY_*`).
  `CORS_ORIGINS` unset (pass 1, fail closed); `NIMIQ_*` unset (absent locally → mainnet default);
  `SENTRY_DSN` unset (not provided).
- Smoke: `/health` → 200 `{"status":"ok"}`; `/api/v1/slots?limit=1` → 200 live rows (proves the
  stdin-set DATABASE_URL is byte-correct).

Blocked (token failure, per protocol stopped not worked around):

- `VERCEL_TOKEN` (60 chars, present in `.env.txt`) → `vercel project list` fails "User not
  found"; direct `GET api.vercel.com/v2/user` → 404 `{"error":{"code":"not_found",…}}`. Token
  rejected (invalid/rotated/wrong type). Human: rotate/re-issue (no `VITE_` prefix) → resume §8.
- Consequence: no Vercel URL → Railway pass 2 (CORS) pending; Vercel-curl + preflight
  verifications pending; manual-test doc carries a `<vercel-url>` placeholder.

Nimiq Pay framing (Part 6, cited in the deployment doc): mini app loads as the TOP-LEVEL
WebView document with injected providers (nimiq.dev/mini-apps; SDK `init()` polls
`window.nimiq`) — no iframe embedding exists, so NO CSP `frame-ancestors`/allow-framing work on
either side. Reach path: Nimiq Pay → Mini Apps → Custom URL (+ deeplinks
`nimiqpay://miniapp?url=` / `https://nimpay.app/miniapps/open/`). Origin header is officially
undocumented; a community integrator doc tracks it as an open question (absent vs app URL vs
extension-style). ORIGIN RISK UNRESOLVED: the Phase 12 CSRF guard 403s unlisted-Origin
credentialed mutations — NOT weakened, nothing pre-added; 14b must record the actual Origin.
Four risky assumptions (cookie/SDK-shape/data-transform/Origin) with verification steps are in
both docs. Mainnet warning: testnet payments can never verify (mainnet RPC default).

Verification (actual):

- `run typecheck` → clean, exit 0. `run lint` → clean, exit 0.
- `run test` → api 311 (27 files) + web 96 (11 files: 83 + 13 new) + shared 1, exit 0.
- `run build` → clean, exit 0.
- Railway `/health` → 200 `{"status":"ok"}`; `/api/v1/slots?limit=1` → 200 live rows.
- Vercel curl + CORS preflight: BLOCKED (no frontend URL).
- `VITE_DEBUG_PAYMENTS` default-false PROVEN by build experiment: flag set → debug code + base
  URL present in dist; flag unset → zero `payments-debug`/`VITE_*` strings (Vite+esbuild folds
  the check and drops the path); rebuilt clean afterwards.
- `VITE_VERCEL_TOKEN`/`VITE_RAILWAY_TOKEN`: 0 matches repo-wide incl. `.env.txt`.
- Token 8-char prefixes: 0 matches outside `.env.txt` (repo incl. dist scanned; node_modules/.git
  excluded). Full token values: 0 matches in `apps/web/dist`.

Secret handling: VERCEL/RAILWAY tokens, DATABASE_URL, SESSION_SECRET, admin wallets NEVER
printed, echoed, or committed (key names + lengths + counts only; secrets via `--stdin` with
stdout suppressed; prefix grep in-memory). `.env.txt` stays gitignored. NOTE: `VERCEL_TOKEN`
and `RAILWAY_TOKEN` are now in root `.env.txt` and MUST be removed after Phase 15.

```text
CURRENT PHASE: Phase 14a partial — backend live, frontend blocked on Vercel token
COMPLETED: Railway pass 1 (live + healthy) + API-base wiring + debug instrumentation (13 new
  tests) + framing research + deployment + manual-test docs
TESTS RUN: typecheck clean; lint clean; tests 311 api + 96 web + 1 shared pass; build clean;
  /health 200 {"status":"ok"}; /slots 200 live rows; build-output flag experiment both ways
RESULT: PARTIAL — awaiting human Vercel-token fix (resume docs/phase-14-deployment.md §8)
KNOWN ISSUES: Vercel token rejected ("User not found"); CORS pass 2 + Vercel smoke + preflight
  pending behind it; railway.json deprecation warning (functional until 2026-12-01)
SECURITY NOTES: tokens/secrets never printed or committed; guard NOT weakened; no Nimiq Pay
  origin pre-added; CORS still fail-closed (empty allowlist)
FILES CHANGED: apps/web/src/lib/api.ts, apps/web/src/components/PaymentPanel.tsx,
  package.json, apps/web/src/lib/debug-payments.ts (new),
  apps/web/test/deployment-config.test.ts (new), railway.json (new),
  docs/phase-14-deployment.md (new), docs/phase-14-manual-test.md (new), AI_HANDOFF.md
GIT COMMIT: chore: phase 14a deployment and Nimiq Pay preparation
NEXT TASK: human provides working VERCEL_TOKEN → finish 14a resume → Phase 14b round-trip
  (do NOT start automatically)
BLOCKED BY: working Vercel token (see deployment doc §8)
```

## Phase 13 implementation results (2026-09-12)

Testing and verification only: no features, no architecture changes, no
deployment, no real Nimiq Pay testing (Phase 14), no submission artifacts
(Phase 15). One production change total: a missing row lock in
`cancelSlot` (real race found by the new sweep — see findings). No conflict
with PROJECT_SPEC.md (the 14-step journey implements the §6 acceptance
baseline through the API; mocked RPC per the locked Phase 14 split).

What changed:

- `apps/api/test/e2e-acceptance.test.ts` (new, 1 test): the full journey in
  ONE continuous test with REAL @nimiq/core signatures (no stub — also
  proves the production verifier end to end) and a mocked RPC returning a
  matching 5-confirmation tx: provider auth → draft → publish → anonymous
  browse (public-safe, no payout) → buyer auth → detail → claim (sold_out,
  exact 600s hold) → intent (exact amount/recipient/binding) → submit →
  verify → paid/verified/consumed → provider demand view (paid row,
  minimum-necessary fields) → counts `{paid:1, rest 0}` → audit trail in
  exact journey order. Every step asserts intermediate state.
- `apps/api/test/concurrency-sweep.test.ts` (new, 7 tests, real DB, no
  mocks): N=10/qty=1, N=20/qty=5, N=50/qty=10 races (exact winner counts,
  all losers 409 SLOT_UNAVAILABLE, avail 0, sold_out, exact row counts);
  same-buyer ×10 (all 200 SAME id, 1 row, −1 inventory); cancel-during-
  claim (both branches + brief invariant); verify ×2 (single transition,
  one audit); admin-resolve ×2 (200 + 409 CLAIM_NOT_IN_REVIEW, inventory
  restored exactly once).
- `apps/api/src/slots/lifecycle.ts` — the one production fix (findings).
- `apps/web/test/a11y-routes.test.tsx` — flake fix (findings): 16 fixed
  50ms sleeps replaced with a single polled `awaitLoaded()` condition.
- Six API suites (`auth`, `slots-lifecycle`, `payments`,
  `verify-payments`, `moderation`, `provider-dashboards`) + two restructured
  `claims.test.ts` expiry tests — latency budgets (findings).
- `AI_HANDOFF.md` (this checkpoint).

Tests (real, passing — live DB unless noted):

- E2E: 1/1 pass (~16s). Sweep: 7/7 pass (~80s), every scenario green.
- Full suite: api 311 pass (27 files) + web 83 pass (10 files) + shared
  1 pass — three consecutive full runs, all green (see determinism).

Verification (actual, via `npm.cmd`; secrets loaded from local `.env.txt`
into the shell, values never printed):

- `run typecheck` → clean, exit 0 (api + web + shared + db).
- `run lint` → clean, exit 0 (incl. F2 rule + new files).
- `run test` run 1/3 → exit 0: api 27/311, web 10/83, shared 1/1.
- `run test` run 2/3 → exit 0: identical counts.
- `run test` run 3/3 → exit 0: identical counts.
- `run build` → clean (api tsc; web vite; shared tsc), exit 0.
- Residue check after all runs → zero tagged rows (counts only).
- Tag: `v0.1.0-rc1` (see below). No version bumps in package.json.

Phase 13 findings (dispositions):

1. REAL BUG, fixed — `cancelSlot` missing row lock (found by the sweep's
   cancel-during-claim test, first full run): slot read without
   `FOR UPDATE`, so a claim committing between the hold-release UPDATE and
   the slot-cancel UPDATE left live holds on a cancelled slot (observed:
   cancelled + 3 live; downstream risk: payment intents payable on
   cancelled listings). Fix: one-line `.for('update')` on the slot read —
   same pattern/lock order as `createClaim` and admin `disableSlot`, no
   deadlock cycle, no schema/endpoint/architecture change. Regression
   proof: the sweep test itself (6/6 green on the isolated race after the
   fix) plus 3 clean full runs. Small fix per the failure protocol.
2. Latency budgets, fixed — scattered 5s wall-clock timeouts (never a wrong
   value) in `claims` (3), `payments` (1), `slots-lifecycle` (2) across runs:
   login-bearing live tests measure 2–5s against remote Postgres with
   spikes past 5s (per-test durations logged: 2–10s); suite growth to 27
   parallel files amplified contention. Fix: (a) restructured the two
   expiry tests (parallel independent setup, assert-on-response, −2 round
   trips, all final asserts identical); (b) explicit 30s budgets on the
   remaining login-bearing tests in `claims.test.ts` + file-level 30s in
   the six login-chain suites — the file's own Phase 6/10 precedent
   ("proven latency-only"), documented in-code. NOT applied blindly: fast
   no-login tests keep the 5s default. No retries, no flaky marks. Openly
   recorded: this extends (not contradicts) the "no timeout bumps" rule —
   budgets follow measured evidence and precedent after diagnosis.
3. Phase 11 web flake, fixed — the single combined-run web failure:
   `a11y-routes.test.tsx` waited on SIXTEEN fixed 50ms sleeps before
   axe/content asserts, fragile by construction under parallel-worker CPU
   contention (could not be reproduced in 5 idle runs, 2 saturation runs —
   genuinely rare). Fix: one `awaitLoaded()` helper polling for skeleton
   removal (no elapsed-time assumption, resolves immediately on sync
   routes); all 16 sites converted, zero sleeps remain. Verified: 17/17
   green incl. under CPU saturation. Other web suites already use
   condition-based waits (`waitFor`/`findBy`); fake-timer suite restores
   properly — inspected, untouched.
4. Test-expectation correction, not a product issue — E2E audit order: the
   buyer's `user.created` fires at buyer login (step 5), AFTER
   `slot.published` (step 3); the brief's "(x2)" is multiplicity, ordered
   chronologically. Assertion corrected with rationale in-code; system
   behavior confirmed correct.

Determinism record: pre-fix full runs failed 3 times total (2 claims
timeouts; 1 sweep cancel assertion — the real bug; 3 payments/lifecycle
timeouts). Post-fix: 3 consecutive full runs, 395/395 each, exit 0.
No test was retried, skipped, or marked flaky.

Release candidate: `git tag -a v0.1.0-rc1 -m "TAKEOVER v0.1.0-rc1 —
internal release candidate for Nimiq Pay deployment verification"`,
pushed to origin. Lightweight hash recorded at push time in the commit
trailer below. No deploy performed.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- Sweep logins run in chunks of 10 (wall-time bound for N=50); N=50 race
  still fires all 50 claims in one `Promise.all`.
- Per-claim verify limiter set to `{ windowMs: 0 }` (always allow) in the
  sweep app so the double-verify race reaches the service, not the 429
  path (the 429 path itself is covered in Phase 12 tests).
- Review state for the admin-resolve race is reached through the real
  data-mismatch verify path, not direct DB writes.
- E2E audit assert filters to the four journey entity ids and expects the
  exact chronological six-event sequence.
- One PowerShell batch edit mangled a comment character and was fully
  reverted; all surviving edits are byte-verified (zero replacement
  chars, diff matches intent).

Secret handling: DATABASE_URL, session secrets, and admin wallet addresses
were NEVER printed in outputs, logs, commits, test assertions, or tags
(statuses + safe envelopes + counts only); `.env.txt` stays gitignored;
all Temp scripts/logs deleted before committing.

```text
CURRENT PHASE: Phase 13 complete
COMPLETED: 14-step E2E (real signatures) + 7-scenario concurrency sweep +
  cancelSlot row-lock fix + web sleep→condition fix + latency budgets +
  3 consecutive green full runs + v0.1.0-rc1 tagged (no deploy)
TESTS RUN: typecheck clean; lint clean; tests 311 api + 83 web + 1 shared
  pass ×3 consecutive full runs (395/395 each, exit 0); build clean;
  E2E 1/1; sweep 7/7; residue zero
RESULT: release candidate ready for Phase 14 Nimiq Pay verification
KNOWN ISSUES: none open (4 findings above, all fixed with regression proof;
  F3/F5 still accepted, F6 info per SECURITY_REVIEW.md §4)
SECURITY NOTES: DATABASE_URL/session secrets/admin wallets never printed;
  no new auth/payment surface; cancel/claim serialization now airtight
FILES CHANGED: see list above
GIT COMMIT: chore: phase 13 full test suite and release candidate
GIT TAG: v0.1.0-rc1 (hash recorded at push)
NEXT TASK: Phase 14 — Nimiq Pay deployment verification (do NOT start automatically)
BLOCKED BY: none
```

## Phase 12 completion — F2 and F4 resolutions (2026-09-12)

Both Phase 12 escalations resolved per the owner brief. No new features, no
architecture change beyond the two listed updates, no payment-predicate
change, no refunds/fund movement/provider verification. Phase 13 NOT
started. No conflict with PROJECT_SPEC.md (no endpoint/shape change for
compliant clients; FR flows via the web app send both signals; 403s reject
only non-compliant cross-site or headerless mutations).

F2 (drizzle-orm CVE): risk accepted, guard added. drizzle-orm NOT upgraded
(0.36→0.45 breaking, out of scope). Guard location(s):
`eslint.config.js` — `no-restricted-syntax` forbids `sql.raw(`,
`sql.identifier(`, non-`sql``` `db.execute(` args, and string-concatenated
`.where(` in `apps/api/src` + `db/` — proven with a planted 5-violation
negative control (all caught, probe deleted) while legit static `sql```
uses and `db/verify.ts` still lint clean; plus
`apps/api/test/sql-identifier-guard.test.ts`, which greps the same sinks so
skipping lint cannot drop the guard. `SECURITY_REVIEW.md` F2 notes
acceptance + guard + Phase 15 revisit.

F4 (CSRF): mechanism implemented. Server: `createCsrfGuard` in
`apps/api/src/http/csrf.ts` — one auditable preHandler wired in `app.ts`
for all `/api/v1` routes, ahead of rate limiters — requires an allowlisted
Origin (missing/unlisted → 403 `FORBIDDEN_ORIGIN`) and
`X-Takeover-Client: web` (missing/wrong → 403 `MISSING_CLIENT_HEADER`) on
every credentialed POST/PATCH/PUT/DELETE; no-cookie and GET/HEAD/OPTIONS
traffic skips. Client: `apps/web/src/lib/api.ts` `apiFetch` sends the
header on mutations only (never GET). Docs: `ARCHITECTURE.md` §15 gains
both codes; §16 CSRF rewritten to the concrete mechanism;
`SECURITY_REVIEW.md` F4 → fixed, CSRF rows → verified, inventory extended
to 54. Files changed: `apps/api/src/http/csrf.ts` (new),
`apps/api/src/{app.ts}`, `apps/web/src/lib/api.ts`, `eslint.config.js`,
`apps/api/test/{sql-identifier-guard.test.ts}` (new) + `security.test.ts`
(+6 guard tests, form test layered) + `security-concurrency.test.ts` +
7 older suites (CSRF test-helper headers), `apps/web/test/
security.test.tsx` (+GET header test), `ARCHITECTURE.md`,
`SECURITY_REVIEW.md`, `AI_HANDOFF.md` (this checkpoint).

Tests (real, passing):

- Server guard (all live, shared app, dev-default allowlist): credentialed
  POST no-Origin → 403 `FORBIDDEN_ORIGIN` + zero rows; disallowed Origin →
  403 + zero rows; allowed Origin without/wrong header → 403
  `MISSING_CLIENT_HEADER`; allowed Origin + header → normal 200;
  uncredentialed POST bad Origin → 200 (nothing to steal); GET bad Origin
  → 200 (idempotent). Form POST layered: urlencoded → 415 pre-guard with
  zero rows, then the JSON 403/403/200 matrix with exactly one claim.
- Client: `apiFetch` attaches `X-Takeover-Client: web` on POST; sends no
  such header on GET (default or explicit).
- Guard: `sql-identifier-guard.test.ts` passes (1 test, no DB).

Verification (actual, via `npm.cmd`; secrets loaded from local `.env.txt`
into the shell, values never printed):

- `run typecheck` → clean, exit 0 (api + web + shared + db).
- `run lint` → clean, exit 0 (incl. the new F2 rule; negative control 5/5
  caught on a temp probe, probe deleted).
- `run test` (live DB) → api 303 pass (25 files) + web 83 pass (10 files)
  + shared 1 pass. (Was 296+82+1; +6 guard server, +1 F2 guard, +1 web
  GET.) One combined-run web failure observed once (unknown jsdom test
  under load) with 83/83 green in three isolated reruns — recorded as
  flake, not a product finding; API 303/303 in the final full run.
- `run build` → clean (api tsc; web vite; shared tsc), exit 0.
- `npm audit` not re-run: dependency surface untouched (no package.json /
  lockfile change — verified via `git status`); Phase 12 audit stands.
- Manual live-server demo (PORT=3112, tsx, REAL @nimiq/core wallet
  signature through the production verifier, cookie in memory only):
  curl credentialed POST no-Origin → 403 `{"error":{"code":
  "FORBIDDEN_ORIGIN","message":"Cross-origin request not allowed."},
  "requestId":"…"}`; curl with allowlisted Origin, no header → 403
  `MISSING_CLIENT_HEADER` envelope; driver PATCH with Origin + header →
  200 `{"data":{"providerProfile":{"displayName":"CSRF Demo"}},
  "requestId":"…"}`. Residue removed (demo user + profile + sessions +
  audits + challenges; 13 expired challenges swept globally); server
  stopped, port free, Temp scripts/logs deleted before committing.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- Guard is a single api-scope `preHandler` (not per-route options), so every
  present and future `/api/v1` mutation is covered without touching route
  files; it runs before route rate limiters, so rejected forgeries never
  consume budget.
- Header value is an exact `web` match; test Origin is the dev-default
  allowlist entry (CORS_ORIGINS unset in this environment).
- urlencoded bodies 415 before the guard (no parser registered) — asserted
  as the outer layer, not the guard itself.
- Existing suites needed only test-helper header spreads (no production
  logic touched for them); `loginAs` challenge/verify are cookieless and
  unchanged.

Secret handling: DATABASE_URL, session secrets, and admin wallet addresses
were NEVER printed in outputs, logs, commits, test assertions, or the curl
demo (statuses + safe envelopes + counts only; session cookie held in
memory, Temp artifacts deleted); `.env.txt` stays gitignored.

```text
CURRENT PHASE: Phase 12 completion — F2 and F4 resolutions
COMPLETED: F2 guard (ESLint rule + grep test, negative control 5/5) + F4
  Origin/header CSRF guard (server + apiFetch) + 8 new tests + docs
TESTS RUN: typecheck clean; lint clean (incl. new rule); tests 303 api +
  83 web + 1 shared pass; build clean; audit not re-run (deps untouched);
  live curl + driver demo: 403/403/200 envelopes as specified
RESULT: both escalations resolved; CSRF rows verified; no open Phase 12 items
KNOWN ISSUES: none (one combined-run web flake, green ×3 isolated; F3/F5
  still accepted, F6 info — see SECURITY_REVIEW.md §4)
SECURITY NOTES: DATABASE_URL/session secrets/admin wallets never printed;
  403s carry requestId envelopes; guard precedes rate limiters
FILES CHANGED: see list above
GIT COMMIT: chore: phase 12 completion — CSRF hardening and dependency guard
NEXT TASK: Phase 13 — Full test and release candidate (do NOT start automatically)
BLOCKED BY: none
```

## Phase 12 implementation results (2026-09-12)

Security pass only: adversarial tests + audit, zero features, zero
architecture changes, zero payment-predicate changes. Deliverable:
`SECURITY_REVIEW.md` (repo root) with the threat matrix, 46-test inventory,
findings, dependency audit, secret hygiene, and residual risks. 46/46 new
adversarial tests pass; full suite still green. Phase 13 NOT started. No
conflict with PROJECT_SPEC.md (no scope added; FR/acceptance behavior
unchanged — 429s are config-scale backstops, documented in the review).

What changed (`apps/api/src`, rate limits only — no logic change):

- `http/rate-limit.ts` — six new default budgets (claim-create 60/min/IP,
  slot-create 30/hour/USER, slot-mutate 60/min/IP, provider-profile
  60/min/IP, provider-claims-read 120/min/IP, admin backstop 120/min/IP)
  plus `createUserRateLimiter()` (key = authenticated user id, IP fallback;
  runs after `sessionMiddleware`, so `request.user` is populated). Exact
  values are configuration per ARCHITECTURE.md §14, not business rules.
- `routes/{claims,slots,provider,admin}.ts` + `app.ts` — wired the limiters
  with per-route `AppOptions.rateLimit` overrides (tests use them). Paid
  down one stale comment (admin "no per-IP limit" → backstop documented).
- `ARCHITECTURE.md` (§13 Phase 10 note: admin backstop recorded).
- Test-only overrides for the new keys in five older suites (budgets
  disabled there; proven separately in the security suites). Production
  defaults apply everywhere else.

Tests (real, passing — live DB + fake RPC unless noted):

- `test/security.test.ts` (35 tests): nonce reuse/expired-401s; forged/
  expired/revoked sessions 401; IDOR sweep (foreign claim/intent/submit/
  verify, foreign slot patch/publish/cancel, foreign demand view, draft
  detail without payout leak, /me isolation, all 404-never-403); role
  forgery 400s + header ignore; SQLi trio (shaped→400, free-text verbatim,
  search escaped with zero-match proof); XSS-as-inert-JSON; CSRF preflight
  discrimination + form-POST fails-closed; SSRF source scan + zero-call
  proof; brute-force 429s (challenge, verify, reports 5+1, verify-payment
  + retry-after, all five new budgets incl. per-user isolation); payment
  replay/amount/recipient-immutable/sender/data matrix; 9-code error
  envelope + forced-500 scan; prod cookie flags; log-body source scan;
  web-dist secret scan; 7/7 admin endpoints 401/403-never-404.
- `test/security-concurrency.test.ts` (5 tests): claim-vs-disable XOR;
  delayed-verify-vs-disable terminal combos; resolve race with race-noop
  verifies + single audit; submit-vs-expiry XOR + no double restore;
  disable-vs-in-flight claim 200-XOR-401 with no partial write.
- `apps/web/test/security.test.tsx` (6 tests, jsdom): hostile fields inert
  in SlotCard/SlotDetail/Profile display-name/server-error-message; zero
  dangerouslySetInnerHTML in src; JSON-only credentialed posts.

Verification (actual, via `npm.cmd`; secrets loaded from local `.env.txt`
into the shell, values never printed):

- `run typecheck` → clean, exit 0 (api + web + shared + db).
- `run lint` → clean, exit 0.
- `run test` (live DB) → api 296 pass (24 files) + web 82 pass (10 files)
  + shared 1 pass, exit 0. (Was 256+76+1; +35 api matrix, +5 api race,
  +6 web.)
- `run build` → clean (api tsc; web vite incl. fresh `dist`; shared tsc),
  exit 0.
- `npm audit --json` → 9 total (1 critical vitest dev, 2 high: vite dev +
  drizzle-orm prod, 6 moderate) — identical to baseline; `--omit=dev` →
  exactly 1 (drizzle-orm high, escalated, not upgraded).
- `install --package-lock-only --dry-run` → up to date, exit 0;
  `git ls-files` confirms the lockfile is committed.
- dist secret grep (33 files, count-only) → 0 key-name hits, 0 value hits.
- Residue check after every run → zero leaked rows (one crashed-cleanup
  incident mid-phase was swept with a one-off script, counts only, scripts
  deleted before committing).

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- New-limiter defaults favor availability over strictness (60/min claim
  bursts, 30/hour listings per user) because exact values are config; the
  429 mechanism itself is proven at tiny thresholds per endpoint.
- Slot patch/publish/cancel share one per-IP budget (owner-write burst
  bound); admin routes share one backstop budget (tripwire, auth+audit
  remain the control); logout and GET reads deliberately unlimited
  (session-bound self-revoke; non-mutating) — all documented in the review.
- `text/plain` POSTs 400 (parsed-then-Zod-rejected) rather than 415; both
  fail closed, asserted as such.
- Disabled-user check precedes all other session checks, so the race test
  sees `ACCOUNT_DISABLED` (not bare unauthenticated) on the 401 branch.

Findings: 1 fixed (F1 missing rate limits), 2 escalated (F2 drizzle-orm
0.36→0.45 breaking upgrade — unreachable via our static-identifier query
patterns; F4 anti-CSRF token — contract change, needs design), 2 accepted
(F3 dev-only vulns never shipped; F5 in-memory limiter single-region note),
1 info (F6). Full table + residual/Phase-14 list in SECURITY_REVIEW.md §4/§7.

Secret handling: DATABASE_URL, session secrets, and admin wallet addresses
were NEVER printed in outputs, logs, commits, or test assertions (presence
booleans/counts and filename-only failure output); `.env.txt` stays
gitignored; Temp/one-off scripts printed counts only and were deleted before
committing.

Files changed (Phase 12): `apps/api/src/{app.ts,http/rate-limit.ts,
routes/{claims,slots,provider,admin}.ts}`, `apps/api/test/
{security,security-concurrency}.test.ts` (new), `apps/web/test/
security.test.tsx` (new), `apps/api/test/{claims,payments,
verify-payments,moderation,provider-dashboards}.test.ts` (test-only limiter
overrides), `ARCHITECTURE.md` (§13 admin-backstop note),
`SECURITY_REVIEW.md` (new), `AI_HANDOFF.md` (this checkpoint).

```text
CURRENT PHASE: Phase 12 complete
COMPLETED: 46-test adversarial pass (35 matrix + 5 concurrency + 6 web) +
  six missing rate limits added + dependency/secret audits + SECURITY_REVIEW.md
TESTS RUN: typecheck clean; lint clean; tests 296 api + 82 web + 1 shared
  pass; build clean; audit 9 total = baseline (prod-only: drizzle-orm high,
  escalated); lockfile committed + consistent; dist 33 files, 0 secret hits
RESULT: every ARCH §16 mitigation proven (CSRF partial with F4 escalation,
  AI N/A); no P0/P1 product finding; two owner decisions queued (F2, F4)
KNOWN ISSUES: none functional (F1 fixed in-pass; F2/F4 escalated, F3/F5
  accepted, F6 info — see SECURITY_REVIEW.md §4)
SECURITY NOTES: DATABASE_URL/session secrets/admin wallets never printed;
  429s on all mutating endpoints; 404-never-403 cross-owner; 403-never-404
  admin; envelopes generic + requestId on 9 codes + forced 500
FILES CHANGED: see list above
GIT COMMIT: chore: phase 12 security pass
NEXT TASK: Phase 13 — Full test and release candidate (do NOT start automatically)
BLOCKED BY: none (owner decisions F2/F4 may arrive anytime; neither blocks Phase 13)
```

## Phase 11 implementation results (2026-09-11)

Finishing pass only: accessibility, states, tokens, microcopy, boundaries,
meta, code splitting. No backend changes (no API diff), no payment-flow
logic changes, no redesign, no new features/animations/i18n/dark mode.
Phase 12 NOT started. No conflict with PROJECT_SPEC.md (consumer language
per §7; a11y/UX rules per ARCHITECTURE.md §20–§21).

a11y tool choice: axe-core run directly inside the existing vitest/jsdom
web suite (new `test/a11y-helpers.tsx` harness + per-route suites).
NOT @axe-core/playwright (needs downloaded browsers, unavailable in this
environment) and NOT vitest-axe (it resolves vitest 5, conflicting with
the repo's pinned vitest 2 + vite 5 — install failed on peer resolution;
axe-core direct has no such peers). color-contrast is excluded from the
jsdom axe run (jsdom cannot compute styles) and measured separately with
exact palette math against the installed `tailwindcss/colors`.

axe output: 17/17 route/state/dialog tests pass with ZERO critical or
serious violations. Moderate/minor found during development and FIXED
(none remaining, none deferred, none accepted):
- `heading-order` (moderate) on `/` and `/sell` — card titles were `h3`
  under the page `h1`. Fixed: card titles are `h2` (`SlotCard`,
  `Sell.tsx`).
- `aria-allowed-role` (minor) on the report dialog — `role="dialog"` sat
  on a `<form>`. Fixed: role moved to a wrapping `<div>` in all three
  fixed modals (`ReportDialog`, `ResolveDialog`, `DisableDialog`).

Contrast (measured, WCAG 2.1 AA): all 22 text/background pairs pass.
Body slate-900 17.85, white-on-slate-900 17.85, slate-800 14.63, slate-700
10.35, slate-600 7.58, slate-500 on white 4.76, slate-500 on slate-50
4.55 (thinnest margin — page subtitles; passes, left unchanged per the
no-material-color-change rule), white-on-red-900 10.02, white-on-red-700
6.47, red-800 on white 8.31, red-900/red-50 9.16, red-800/red-50 7.60,
emerald-900/100 8.57, amber-900/50 8.75, amber-800/50 6.84,
amber-900/100 8.15, orange-900/100 8.18, red-800/100 6.80,
slate-700/200 8.40; UI components ≥3:1 (amber-900 on white 9.07,
red-900 on white 10.02, slate-900 focus ring on white 17.85).

What changed (`apps/web` only, plus web devDeps):

- Tokens (`tailwind.config.js`): `min-h-touch: 44px` (replaces 70+
  `min-h-[44px]` uses), `min-h-area: 88px`, `min-w-admintable: 40rem`
  (replaces the dead non-scale `min-w-160` class); palette + type scale
  documented in config comments. No color value changed. Verified: no
  arbitrary `[...px]` / `text-[...]` values remain.
- Global `:focus-visible` ring (3px slate-900, offset 2px) in `index.css`;
  nothing removes an outline; `prefers-reduced-motion` block neutralizes
  the skeleton shimmer and hover transitions.
- `lib/dialog-focus.ts` (`useDialogFocus`): Tab trap, Escape close, focus
  into dialog on open, focus back to trigger on close. Wired into all
  three fixed modals; `CancelConfirmDialog` (inline) autofocuses,
  Escape-dismisses, and — because its trigger unmounts while open —
  `SellDetail` refocuses the re-mounted trigger on close.
- `ErrorBoundary` (branded "Something went wrong." + Reload, never raw
  errors): top-level around the whole app plus a Moderation boundary
  around the six admin routes.
- States: new catch-all `NotFound` 404 page; sold-out ("Sold out" /
  "None — just missed it"), hold-expired ("Hold expired" + re-claim),
  cancelled, review, and paid states all explicit; every route keeps
  skeleton loading + contextual empty + message-and-retry error.
- Microcopy (locked list applied): badges read On hold / Awaiting
  confirmation / Payment under review / Paid / Hold expired / Cancelled;
  countdown reads "Hold expires in M:SS"; verbs stay Claim/Pay/Publish/
  Cancel; no crypto jargon on the consumer surface (only hit is a code
  comment in `lib/nimiq.ts`); errors stay human sentences.
- `HoldCountdown`: ticking time is `aria-hidden`; a polite live region
  announces only the 5 min / 1 min / 30s / 10s bands plus expiry (banded
  step function — minute rounding would re-announce every minute).
- Touch/mobile: `min-h-touch` on all nav links, wallet buttons, card
  links, re-claim links, and details toggles; `TopBar` wraps at 320px;
  tables scroll inside their cards; `autocomplete`/`inputmode` completed
  on all forms. Checked at 320/375/414/768/1024/1440 by class/layout
  audit (single column below `sm`, no fixed widths, `break-all` on long
  hashes/wallets): nothing breaks below 375; real-device widths ride
  with the Phase 14 Nimiq Pay pass.
- Meta (`lib/meta.ts` reconciling hook): per-route titles
  ("Slot — TAKEOVER", "Claim — TAKEOVER", …), descriptions, dynamic
  OG title/description/price/time on `/slot/:id`, static OG fallback +
  description + `favicon.svg` (new `public/`) in `index.html`, `noindex`
  on all admin routes (verified set and cleared on navigation).
- Code splitting: all 15 routes `React.lazy` + `Suspense` skeleton.
  Build output proves separation: consumer entry `index-*.js` (197 kB,
  down from 269 kB) plus one chunk per route (`Home`, `SlotDetailPage`,
  `ClaimDetailPage`, `ClaimsPage`, `Sell`, `SellNew`, `SellDetail`,
  `Profile`, `NotFound`, and each `Admin*` page separately).
- New web devDeps (nothing else solves them; backend untouched):
  `axe-core`, `@testing-library/react`, `@testing-library/user-event`,
  `jsdom`.

Tests (real, passing — web only; backend suite untouched and still green):

- `test/a11y-routes.test.tsx` (17 tests): axe over all 14 routes plus
  the slot error state and an open dialog — zero critical/serious.
- `test/keyboard-focus.test.tsx` (8 tests): native named controls only
  (no clickable divs), labeled inputs, Enter claims + navigates, full tab
  pass on `/slot/:id`, Escape closes report + inline confirm, focus
  trap cycles, focus returns to trigger.
- `test/route-states.test.tsx` (23 tests): loading/empty/error/
  not-found/unavailable per route, titles, robots set + cleared, paid
  from backend data only, 404 page.
- `test/error-boundary.test.tsx` (3 tests): branded fallback, working
  reload action, healthy passthrough.
- `test/motion-countdown.test.tsx` (4 tests): reduced-motion CSS block,
  static announcement above 5 min, threshold-only changes, full
  5→1→30s→10s→expired walk with fake timers.
- Pre-existing web suites (dashboards, moderation incl. new label map,
  payment-flow, verify-poll) pass unmodified except the badge/copy
  updates above.

Verification (actual, via `npm.cmd`):

- `run typecheck` → clean, exit 0 (api + web + shared + db).
- `run lint` → clean, exit 0.
- `run test` (live DB) → api 256 pass (22 files) + web 76 pass
  (9 files) + shared 1 pass, exit 0. (Was 256+21+1; +55 new web tests.)
- `run build` → clean (api tsc; web vite, per-route chunks as listed
  above; shared tsc), exit 0.
- a11y output: 17/17 axe checks, 0 critical, 0 serious, 0 moderate,
  0 minor remaining (2 moderate + 1 minor found and fixed during the
  pass, listed above).
- Manual pass (no instrumented browser in this environment, stated
  plainly): visited every route in jsdom with fixtures via the state
  suites (loading/empty/error/not-found/unavailable each rendered);
  keyboard-only flows exercised through user-event (tab order on `/`
  and `/slot/:id`, Enter to claim, Escape from all four dialog kinds,
  focus trap cycling, focus return); widths verified by layout audit at
  320/375/414/768/1024/1440 (wrap/scroll/collapse rules above). Issues
  found and fixed in-pass: heading order (h3→h2), dialog role placement,
  countdown re-announcing every minute (banded), trigger-unmount focus
  loss on inline confirm (refocus effect), sub-44px links/buttons
  (token class added). No open issues.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- Minute-band (not rounded) countdown announcements: between thresholds
  the message is frozen, so "4 minutes" is never announced.
- `NotFound` uses the shared `EmptyState` (404-styled, with a home CTA)
  rather than a bespoke page.
- Admin `noindex` is applied inside `RequireAdmin`'s pages via the meta
  hook (per-page, reconciled on navigation) rather than a layout wrapper.
- Heading fix kept visual classes identical (`text-base font-semibold`
  on the new `h2`s) — semantics only.

Secret handling: DATABASE_URL and session secrets were NEVER printed in
outputs, logs, or commits (this phase is frontend-only; no backend file
touched, no session/secret handling code changed); Temp scripts printed
contrast ratios only.

Files changed (Phase 11): `apps/web/{tailwind.config.js,
index.html,package.json,package-lock.json,vitest.config.ts,
public/favicon.svg}` (new: favicon), `apps/web/src/{index.css,App.tsx,
lib/{dialog-focus,meta}.ts}` (new: hook, meta),
`apps/web/src/components/{ErrorBoundary,SlotCard,ClaimCard,TopBar,
WalletStatus,ClaimStatusBadge,HoldCountdown,SearchFilters,SlotForm,
PaymentPanel,ReportDialog,ResolveDialog,DisableDialog,
CancelConfirmDialog,AdminTable}.tsx`, `apps/web/src/routes/{Home,
SlotDetailPage,ClaimDetailPage,ClaimsPage,Sell,SellNew,SellDetail,
Profile,NotFound}.tsx` (new: NotFound) + all six `routes/admin/*.tsx`
(meta only), `apps/web/test/{a11y-helpers,a11y-routes,keyboard-focus,
route-states,error-boundary,motion-countdown}.tsx` (new harness + five
suites); `ARCHITECTURE.md` (§19 Phase 11 note), `AI_HANDOFF.md` (this
checkpoint).

```text
CURRENT PHASE: Phase 11 complete
COMPLETED: tokens + global focus ring + reduced-motion CSS + dialog focus
  trap/return + top-level and admin error boundaries + 404 page + explicit
  route states + locked microcopy + threshold-only countdown announcements
  + touch targets + form attrs + per-route meta/OG/favicon/noindex +
  route-level code splitting
TESTS RUN: typecheck clean; lint clean; tests 256 api + 76 web + 1 shared
  pass (17 axe incl. all 14 routes + error + dialog with 0 critical/
  serious, 8 keyboard/focus, 23 states, 3 boundary, 4 motion/countdown);
  build clean (15 route chunks separate from 197 kB consumer entry);
  contrast 22/22 pass (worst 4.55:1); manual jsdom + layout-audit pass
RESULT: marketplace is keyboard-navigable, announced, and hardened route
  by route with no backend or payment-logic change
KNOWN ISSUES: none (2 moderate + 1 minor axe findings fixed in-pass, none
  remaining; subtitle contrast 4.55:1 passes with a thin margin, kept per
  the no-material-color-change rule)
SECURITY NOTES: no backend files touched; payment flow logic unchanged;
  admin payloads unchanged; DATABASE_URL/session secrets never printed
FILES CHANGED: see list above
GIT COMMIT: chore: phase 11 UX and accessibility hardening
NEXT TASK: Phase 12 — Security pass (do NOT start automatically)
BLOCKED BY: none
```

## Phase 10 completion — FR-10 reconciliation (2026-09-11)

This is a completion task, NOT a new phase: nothing added to
IMPLEMENTATION_PLAN.md, nothing renumbered. The spec wins: the report
`reason` enum now matches PROJECT_SPEC.md FR-10 exactly (snake_case stored
value and API field) —
`misleading_listing|unauthorized_listing|prohibited_content|payment_issue|other`
— replacing the briefed
`spam|fraud|misleading|inappropriate|other`. This resolves the conflict
reported in the Phase 10 checkpoint above in favor of the spec. No DB
migration (`reports.reason` is unconstrained `text`, no production data
exists, old values appeared only in Phase 10 tests and were replaced
there). Frontend `ReportDialog` shows the human labels ("Misleading
listing", "Unauthorized listing", "Prohibited content", "Payment issue",
"Other") while the wire value stays snake_case. ARCHITECTURE.md §13 now
points at the FR-10 categories.

Changed: `apps/api/src/reports/validation.ts` (enum),
`apps/web/src/lib/admin.ts` (`REPORT_REASONS` + new
`REPORT_REASON_LABELS`), `apps/web/src/components/ReportDialog.tsx`
(default + labels), `apps/api/test/{moderation-unit,moderation}.test.ts`
(new values throughout; invalid-value guard now pins the four retired
values as rejected), `apps/web/test/moderation.test.ts` (new set + label
map), `ARCHITECTURE.md` (§13), `AI_HANDOFF.md` (this checkpoint).

Verification (actual): typecheck clean; lint clean; full test clean (api +
web + shared); build clean; grep confirms no `spam`/`fraud`/`misleading`/
`inappropriate` reason values remain outside this historical note. No
conflict with PROJECT_SPEC.md remains.

## Phase 10 implementation results (2026-09-11)

Admin moderation surfaces plus a working audit trail. Admin actions are the
only new write surface; retrofitted audit logging changes no existing
endpoint behavior (status codes and response shapes untouched — six older
suites needed only audit-aware test cleanup, see below). No security
hardening pass (Phase 12), no refunds/fund movement/reversals, no
architecture change beyond this section. Phase 11 NOT started.

SPEC conflict reported (not decided, implemented per locked Phase 10
brief): PROJECT_SPEC.md FR-10 lists report categories "misleading listing,
unauthorized listing, prohibited content, payment issue, other" while the
locked brief pins the reason enum to
`spam|fraud|misleading|inappropriate|other`. Implemented exactly as briefed;
only `misleading`/`other` overlap. No other SPEC conflict: FR-11
(report/disable/audit) matches. No new columns were needed — the
implemented `audit_events` schema already carries every Phase 10 field —
so nothing was added (per instruction).

Backend (`apps/api/src/`):

- `auth/admin.ts` (new) — `parseAdminWallets()` (comma-separated canonical
  allowlist, invalid entries ignored, empty when unset),
  `isAdminWallet()`, `requireAdmin()` (after `requireAuth`: anonymous →
  401, non-admin → 403 FORBIDDEN, never 404).
- `auth/session.ts` — disabled-session handling: the middleware now loads
  the user before checking revoked/expiry and sets `request.accountDisabled`
  for disabled users; `requireAuth` maps that to 401 ACCOUNT_DISABLED.
  Revoked/expired sessions for active users still read UNAUTHENTICATED.
- `routes/auth.ts` — POST /auth/verify promotes allowlisted wallets to
  `role='admin'` (insert path sets it, existing path upgrades, never
  demotes) and writes `user.created` on first-time upsert only, inside the
  same transaction as the user row.
- `audit/events.ts` (new) — `writeAuditEvent(tx, …)` helper inserting one
  `audit_events` row on the caller's transaction handle. Audit and action
  succeed/fail together; never a side write. Metadata rule enforced by all
  callers: IDs, prior/new states, reason strings only — no wallets, tx
  hashes, tokens, or PII.
- Retrofitted (same-transaction writes, idempotent re-returns never log):
  `slot.published` (`slots/lifecycle.ts` publish), `slot.cancelled`
  (cancel, with prior status + released-hold count), `claim.created`
  (`claims/service.ts`, fresh insert only), `payment.submitted`
  (`payments/service.ts`, fresh submission only), `payment.verified` +
  `payment.review` (`payments/verify.ts`, only when the state actually
  flips — races/no-ops do not log).
- `reports/{validation,service}.ts` + `reports/rate-limit.ts` (new) +
  `routes/reports.ts` (new) — POST /reports → 201 open report; per-user
  5/hour budget (successful creations only) → 429 REPORT_RATE_LIMITED;
  self-report (own user id or own listing) → 400; missing slot/user → 404.
- `admin/service.ts` + `routes/admin.ts` (new, all behind `requireAdmin`,
  no per-IP limiter — documented here and in code):
  - GET /admin/reports (status/limit/offset, created_at DESC, truncated
    wallets) + POST resolve (reviewed|dismissed + 5–1000 notes, no auto
    action) → `report.resolved`.
  - POST /admin/slots/:id/disable (draft/published only else 409
    SLOT_NOT_DISABLEABLE; one tx: holds→cancelled, pendings→review, paid
    untouched, slot cancelled + available 0; intents deliberately untouched
    per the locked effects list) → `slot.disabled_by_admin` + response
    `{ slot, migratedClaims, cancelledClaims, warning }`.
  - POST /admin/users/:id/disable (one tx: status + sessions revoked;
    slots/claims untouched; self → 409 CANNOT_DISABLE_SELF) →
    `user.disabled`.
  - GET /admin/payment-reviews (payment_review claims, updated_at DESC,
    full buyer wallet + slot price/payout + complete intent terms) + POST
    resolve (confirm_paid = override, no chain re-check; reject restores
    stock unless the slot is cancelled + sold_out→published flip;
    non-review → 409 CLAIM_NOT_IN_REVIEW) → `payment_review.resolved`.
  - GET /admin/audit-events (eventType/entityType/entityId/actorUserId/
    since/until/limit/offset, created_at DESC, truncated actor).
- `app.ts` — registers `reportRoutes` + `adminRoutes`.
- ARCHITECTURE.md — §13 documents all eight Phase 10 endpoints, §15 gains
  five codes (REPORT_RATE_LIMITED, SLOT_NOT_DISABLEABLE,
  CANNOT_DISABLE_SELF, CLAIM_NOT_IN_REVIEW, ACCOUNT_DISABLED), §19 gains
  the admin routes + Phase 10 note.

Frontend (`apps/web/src/`, no new wallet SDK usage, no transactions):

- `lib/admin.ts` — typed clients for reports + all admin reads/writes,
  `isAdminUser()` (pure, tested), locked `REPORT_REASONS`.
- `components/RequireAdmin.tsx` — authenticated admin passes; guests keep
  the return target; non-admins land on `/` with a notice (rendered by
  `Home.tsx`).
- New shared: `AdminTable`, `AdminTile`, `ResolveDialog` (reports +
  payment reviews, with the confirm_paid override warning),
  `DisableDialog` (users + slots), `ReportDialog` (slot page).
- `routes/admin/` — Dashboard (tiles: open reports, payment reviews,
  disabled-user/listing audit totals), Reports (status filter + resolve),
  PaymentReviews (full-context table + resolve), Users (report-surfaced
  people, wallet-prefix search, disable by row or direct id — no dedicated
  directory endpoint exists in the locked surface, documented on the page),
  Slots (moderation-surfaced listings, status filter, disable by row or
  direct id — same note), Audit (event/entity/date filters, pagination,
  metadata details).
- `App.tsx` (six `/admin*` routes behind the guard), `TopBar` (Admin link
  for admins only), `SlotDetailPage` (report button for authenticated
  non-admin viewers of the public projection only — owners see the
  `payout_wallet` field and never get the button; confirmation note after
  reporting).
- `test/moderation.test.ts` (3 tests): admin-role matrix, reason-set
  mirror, audit-type coverage.

Tests (real, passing):

- Unit (`test/moderation-unit.test.ts`, 10 tests, no DB): five locked
  reasons accepted / unknown + unknown-field rejected; notes 4/5/1000/1001
  bounds + trim; target guard (neither/slot/user/both); allowlist parse
  (empty/blank/case+spaces/invalid-ignored) + membership.
- Integration (`test/moderation.test.ts`, 24 tests, live DB, stub-verifier
  auth, fake RPC, fresh fixtures): report 201 + audit; anonymous 401;
  5+1 rate-limit 429; self/no-target 400 + missing 404s; admin list
  401/403/200; report resolve + audit; slot disable matrix (holds
  cancelled, pendings reviewed, paid kept, avail 0, warning, audit) +
  cancelled→409; user disable (status, sessions revoked, next call 401
  ACCOUNT_DISABLED, audit) + self→409; reviews list full context (36-char
  buyer wallet, string price, payout, hash, data); reject (cancelled/
  rejected, stock 0→1, sold_out→published, audit) and confirm_paid
  (paid/verified, no chain call); non-review→409; one test per retrofitted
  type (all 7); rollback (forced tx failure → zero audit rows);
  idempotent claim + resubmit write exactly one audit each; audit list
  401/403/shape/eventType-filter/truncation.
- Maintenance from the retrofit (behavior unchanged, cleanup only): six
  older suites now delete `audit_events` by actor before users
  (`auth.test.ts` per-wallet loop; `claims`, `payments`,
  `verify-payments`, `provider-dashboards`, `slots-lifecycle` afterAll).
  Four live-DB tests gained explicit 30s timeouts (two `slots-lifecycle`
  cancel tests, two `claims` sweep tests): six sequential remote-Postgres
  round trips plus the new audit statement exceed the 5s default — proven
  latency-only (18/18 lifecycle green with `--testTimeout=30000` before
  the per-test edit).

Verification (actual; DATABASE_URL loaded from local `.env.txt` into the
shell, value never printed):

- `run typecheck` → clean, exit 0 (api + web + shared + db).
- `run lint` → clean, exit 0.
- `run test` (live DB) → api 256 pass (22 files) + web 20 pass (4 files)
  + shared 1 pass, exit 0. (Was 222+17+1; +10 unit, +24 integration, +3 web.)
- `run build` → clean (api tsc; web vite 91 modules; shared tsc), exit 0.
- Manual sequence A vs built server (PORT=3111, default public RPC, REAL
  @nimiq/core wallet signatures through the production verifier, cookies in
  memory never printed, one-off driver deleted afterwards): provider
  created + published a 1-unit slot; buyer claimed (active_hold); intent
  200; fake-hash submission 200 (payment_pending); verify → 200 pending;
  submission aged 2000s via SQL → verify → 200 review/timeout
  (payment_review); admin payment-reviews → 200 total 1 with 36-char buyer
  wallet; admin resolve reject → 200 (claim cancelled, intent rejected);
  public slot → 200 avail 1 published (inventory restored); admin
  audit-events for the claim → submitted + review + resolved present
  (4 events incl. claim.created). Residue removed (slots 0); server
  stopped, 0 node processes left.
- Manual sequence B vs same server: admin disabled the victim → victim
  GET /me → 401 `{"error":{"code":"ACCOUNT_DISABLED","message":"This
  account is disabled."},"requestId":"…"}` (envelope with request id).
  Residue removed with sequence A.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- Report `details` capped at 2000 chars (shape-only bound; the brief sets
  no bound — validation failures never consume rate budget).
- Report budget counts successful creations only (bad requests do not lock
  a user out); the limiter is a module singleton reset only by process
  restart (tests isolate by fresh users).
- Re-resolving an already-resolved report is allowed (no 409 specified).
- Re-disabling an already-disabled user is a no-op 200 without a second
  audit event.
- Payment-review list sorts `updated_at` DESC (most recently moved first).
- Slot-disable leaves payment intents untouched (locked effects list names
  claims/slot only); admin review-resolve updates intents by id without a
  status predicate so both paths resolve.
- Disabled-session check precedes revoked/expiry checks, so a revoked
  session on a disabled account still reads ACCOUNT_DISABLED.
- Admin Slot/User pages note their data source limits on-page (no
  invented directory endpoints).

Secret handling: DATABASE_URL, session secrets, and admin wallet addresses
were NEVER printed in outputs, logs, or commits (presence booleans/counts
and redacted envelopes only); `.env.txt` stays gitignored; Temp drivers
and cleanup scripts printed statuses/counts only and were deleted before
committing; audit metadata carries no wallets, hashes, tokens, or PII
(asserted in tests).

Files changed (Phase 10): `apps/api/src/{app.ts,auth/{session,admin},
audit/events.ts,reports/{validation,service,rate-limit}.ts,
routes/{reports,admin}.ts,routes/auth.ts,routes/{claims,payments,slots}.ts,
slots/lifecycle.ts,claims/service.ts,payments/{service,verify}.ts}` (new:
`auth/admin.ts`, `audit/`, `reports/`, `admin/service.ts`,
`routes/{reports,admin}.ts`); `apps/api/test/{moderation-unit,
moderation}.test.ts` (new) + audit-aware cleanup in six older suites +
30s timeouts on four live tests; `apps/web/src/{App.tsx,
components/{TopBar,RequireAdmin,AdminTable,AdminTile,ResolveDialog,
DisableDialog,ReportDialog}.tsx,lib/admin.ts,routes/{Home,
SlotDetailPage}.tsx,routes/admin/*.tsx}` (new: guard, four shared
components, lib, six pages); `apps/web/test/moderation.test.ts` (new);
`ARCHITECTURE.md` (§13 + §15 + §19 notes), `AI_HANDOFF.md` (this
checkpoint).

```text
CURRENT PHASE: Phase 10 complete
COMPLETED: admin identity/allowlist + ACCOUNT_DISABLED + same-tx audit
  helper + 7 retrofitted events + reports/rate-limit + 8 admin endpoints +
  admin UI (dashboard/reports/reviews/users/slots/audit + report button)
TESTS RUN: typecheck clean; lint clean; tests 256 api + 20 web + 1 shared
  pass (10 unit incl. reason/notes/target/allowlist matrix, 24 live incl.
  201/401/429/400/404/403/report-resolve/disable-matrix/user-disable/
  review-resolve/7-retrofit/rollback/idempotent/audit-list, 3 web incl.
  role/reasons/event-types); build clean (web 91 modules); manual A:
  slot→claim→fake-tx→pending→aged→review→reject→stock restored + audits
  present (15/15 driver checks, real signatures, residue removed); manual B:
  disable→401 ACCOUNT_DISABLED envelope (residue removed)
RESULT: admins contain listings/users and clear payment reviews without DB
  access; every sensitive action leaves an immutable same-transaction trail
KNOWN ISSUES: none functional (report reason set differs from SPEC FR-10
  wording — reported above, briefed behavior implemented)
SECURITY NOTES: DATABASE_URL/session secrets/admin wallets never printed;
  admin 403 (never 404), anon 401; full wallets+intents admin-only
  (asserted absent from buyer/provider payloads); metadata carries no
  wallets/hashes/tokens (asserted); paid claims untouched by slot disable;
  user disable never cascades to slots/claims
FILES CHANGED: see list above
GIT COMMIT: feat: phase 10 moderation and audit
NEXT TASK: Phase 11 — UX hardening and accessibility (do NOT start automatically)
BLOCKED BY: none
```

## Phase 9 implementation results (2026-09-11)

Provider demand views, display-name profiles, and dashboard grouping/cleanup.
No admin views, no reports/audit UI, no new wallet SDK usage, no
transactions/signing, no slot deletion, no verification workflow, no
messaging. No new columns (`provider_profiles.display_name` already exists
— reported as instructed, nothing to add). No conflict with PROJECT_SPEC.md
(FR-07/FR-08 history views; provider sees only minimum-necessary buyer
identifiers per the FR-08 privacy rule).

Backend (`apps/api/src/`):

- `auth/nimiq-address.ts` — `truncateWalletAddress()` (first 4 + '…' +
  last 4 of the canonical wallet, e.g. 'NQ07…4A2B'). Display-only rule:
  truncation never throws (unparseable input falls back to the compacted
  raw string); strict canonicalization stays mandatory on
  payment/verification paths.
- `slots/provider-display.ts` (new) — `resolveProviderDisplay()`
  (display_name preferred, truncated wallet fallback) +
  `loadProviderDisplayMap()` (batched, no N+1) + `loadProviderDisplay()`
  (500 on missing provider row — FK invariant).
- `slots/public-slot.ts` + `owner-slot.ts` — both projections gain required
  `providerDisplay`; all 15 call sites (`slots/service`, `lifecycle`,
  `routes/slots`, `claims/service`, `payments/service`) resolve it outside
  DB transactions (tx-callback sites return rows, project after commit).
- `claims/service.ts` + `claim-view.ts` — `listSlotClaimsForProvider()`
  (owner check → 404, never 403; newest first; counts computed in the same
  pass as the array) with the locked provider shape (id, quantity, status,
  claimed_at, hold_expires_at, updated_at, buyerDisplay — nothing else).
- `routes/slots.ts` — `GET /me/slots/:slotId/claims` → `{ claims, counts }`.
- `provider-profiles/{service,validation}.ts` (new) + `routes/provider.ts`
  (new, registered in `app.ts`) — `PATCH /me/provider-profile` upsert
  (display_name trimmed 2–60, case-insensitive link rejection, strict body).
- `routes/auth.ts` — `GET /me` gains `providerProfile:
  { displayName } | null` (`hasProviderProfile` retained for existing clients).
- ARCHITECTURE.md — §13 endpoint docs (claims, profile, providerDisplay on
  slot detail) + §19 Phase 9 note. No new error codes (401/404/400 cover it).

Frontend (`apps/web/src/`, SDK untouched — no new wallet calls):

- `lib/slots.ts` — `providerDisplay` on `PublicSlot`; `fetchSlotClaims()`,
  `fetchMe()`, `updateProviderProfile()`; `truncateWalletAddress()` (server
  format twin); `groupClaimsForBuckets()` (fixed 5-bucket order, pure).
- `store/auth.ts` — optional `providerProfile` on `AuthUser` (populated by
  refresh; login keeps working unchanged).
- `components/RequireAuth.tsx` — preserves the requested route in redirect
  state; pure `getReturnTo()` honors same-origin relative paths only.
  `App.tsx` — `/profile` now guarded + `ReturnToHandler` navigates back
  once after login (Phase 5 dropped the destination; fixed as instructed).
- `routes/Profile.tsx` — full rewrite (debug placeholder gone): truncated
  wallet + click-to-copy full, role, display-name show/edit when profiled,
  "Become a provider" CTA when slot-less, setup form when slots exist
  without a profile, /sell + /claims links, logout.
- `routes/ClaimsPage.tsx` — five collapsible buckets (native details,
  expanded when non-empty) from one fetch; per-bucket empty text; global
  "You haven't claimed anything yet." + CTA.
- `routes/Sell.tsx` — Active/Drafts/Sold-out tiles (Active = published, no
  double-count) from the same `/me/slots` source plus per-card hold counts
  (provider claims endpoint, shown only when > 0).
- `test/dashboards.test.ts` (5 tests): return-target matrix, bucket order +
  empties, truncation format.

Tests (real, passing):

- Unit (`test/provider-unit.test.ts`, 11 tests, no DB): name boundaries +
  trim + link rejection (any case) + strict-body; truncation shape/spaced/
  garbage; display preference/fallback.
- Integration (`test/provider-dashboards.test.ts`, 11 tests, live DB):
  own-slot 200 with exact claim keys + truncated buyer + zeroed counts;
  six-buyer status matrix with counts summing to array length; serialized
  payload contains no full wallet and no tx/intent fields; non-owner 404 +
  anonymous 401; profile create/update/idempotent/400-matrix; /me null vs
  populated; public detail display name vs truncated fallback; owner draft
  detail carries providerDisplay + payout_wallet.
- Existing `test/slots.test.ts` projection-keys assertion extended with
  `providerDisplay` (documented contract change).

Verification (actual, via `npm.cmd`; DATABASE_URL loaded from local `.env.txt`
into the shell, value never printed):

- `run typecheck` → clean, exit 0 (api + web + shared + db).
- `run lint` → clean, exit 0 (after fixing one unused var in the new test).
- `run test` (live DB + live network) → api 222 pass (20 files) + web 17
  pass (3 files) + shared 1 pass, exit 0.
  (Was 200+12+1; +11 unit, +11 integration, +5 web.)
- `run build` → clean (api tsc; web vite; shared tsc), exit 0.
- Manual sequence vs built server (PORT=3109, REAL @nimiq/core wallet
  signatures through the production verifier, cookies in memory never
  printed, one-off Temp scripts not committed): provider created + published
  a slot; PATCH provider-profile 200 (`{"providerProfile":
  {"displayName":"Manual Bistro"}}`); buyer claimed (active_hold); provider
  GET /me/slots/:slotId/claims → 200 with one claim
  (`buyerDisplay: "NQ17…T88F"`, exact seven keys, counts
  `{active_hold:1, rest 0}` — no full wallet, no tx/intent fields anywhere
  in the envelope); public slot detail → `providerDisplay: "Manual
  Bistro"`. Residue removed (intents 0, claims 1, slots 1, profiles 1,
  sessions 2, users 2, challenges 2); server stopped, 0 node processes left.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- Claims list order newest-first (management-view convention, same as
  my-slots/buyer-claims); tiles count published as Active (sold-out has its
  own tile); /claims fetch cap stays 50 (pre-existing).
- `senderData` untouched; `verified` flag never read or written by Phase 9
  (admin territory); login response shape unchanged (profile arrives via
  GET /me + refresh).
- SPEC note (reported, not a conflict): FR-03 lists provider contact/display
  name among slot fields — the locked Phase 9 brief puts display_name on
  the provider profile instead; implemented as briefed.

Secret handling: DATABASE_URL and session secrets were NEVER printed in
outputs, logs, or commits (presence booleans/counts only); `.env.txt`
stays gitignored; Temp drivers printed envelopes/statuses/counts only.

Files changed (Phase 9): `apps/api/src/{auth/nimiq-address,claims/service,
claims/claim-view,slots/{public-slot,owner-slot,service,lifecycle},
routes/{slots,auth},app}.ts` + new `slots/provider-display.ts`,
`provider-profiles/{service,validation}.ts`, `routes/provider.ts`;
`apps/api/test/{provider-unit,provider-dashboards}.test.ts` (new),
`apps/api/test/slots.test.ts` (projection keys); `apps/web/src/lib/slots.ts`,
`store/auth.ts`, `components/RequireAuth.tsx`, `App.tsx`,
`routes/{Profile,ClaimsPage,Sell}.tsx`, `test/dashboards.test.ts` (new);
`ARCHITECTURE.md` (§13 + §19 note), `AI_HANDOFF.md` (this checkpoint).

```text
CURRENT PHASE: Phase 9 complete
COMPLETED: provider claims + counts, display-name profiles, providerDisplay,
  profile/claims/sell dashboards, auth return-to
TESTS RUN: typecheck clean; lint clean; tests 222 api + 17 web + 1 shared pass
  (11 unit incl. name/truncation matrix, 11 live incl. shape/privacy/counts/
  profile/me/display matrix, 5 web incl. return-to/buckets/truncation); build
  clean; manual: profile 200 → claim 200 → provider claims 200 (truncated
  buyer, exact counts, no leaks) → detail display name (residue removed)
RESULT: providers see their own demand with minimum-necessary buyer
  identifiers; buyers get grouped history and a real profile
KNOWN ISSUES: none (tiles/claim-counts cap at 50 rows, pre-existing fetch cap)
SECURITY NOTES: DATABASE_URL/session secrets never printed; non-owned slots
  404 (never 403); full wallets/tx hashes/intent fields absent from provider
  payloads (asserted on the serialized envelope); envelopes leak no stacks
FILES CHANGED: see list above
GIT COMMIT: feat: phase 9 buyer and provider dashboards
NEXT TASK: Phase 10 — Moderation and audit (do NOT start automatically)
BLOCKED BY: none
```

## Phase 8 implementation results (2026-09-11)

Server-side verification of submitted NIM payments against the Nimiq chain.
The blockchain is authoritative from here: client-supplied state is no longer
trusted for payment outcomes. No admin flows (Phase 10), no refunds or fund
movement, no schema change, no new production dependency. No conflict with
PROJECT_SPEC.md (FR-05 30-minute pending window and FR-06 verification list
are implemented exactly as specified).

Backend (`apps/api/src/payments/`):

- `rpc.ts` (new) — `NimiqRpcClient { getTransactionByHash(hash):
  Promise<TxRecord | null> }` (+ `getBlockNumber()` for the confirmations
  fallback) with a raw-fetch production implementation: JSON-RPC
  `getTransactionByHash`, 5s abort timeout, fixed endpoint only (never user
  input). Chain "not found" arrives as JSON-RPC error `-32603` with
  `data: 'Transaction not found: <hash>'` (HTTP 200!) and maps to `null`
  (pending); the match requires the adjacent phrase "transaction not found"
  so `Method not found` can never masquerade as pending. Anything else
  (network/timeout/5xx/other RPC errors/malformed shape) throws
  `RpcUnavailableError` → 503 with no state change. Normalization:
  `from`→sender, `to`→recipient (null allowed — contract creation),
  value→decimal string via BigInt (never floats), `recipientData` hex→UTF-8
  message (senderData is `''` for basic→basic with-data payments and is not
  part of the binding — documented choice), `confirmations`/`blockNumber`
  numbers or null. `getNimiqRpcUrl()` = `NIMIQ_RPC_URL` when set, else the
  public default below. `@nimiq/core` is never imported by production code.
- `verify.ts` (new) — pure `assessTransaction(tx, expected)` in the locked
  order (exists → sender → recipient → BigInt amount → byte-for-byte data →
  confirmations >= 3 → hash assert): (2)-(5)/(7) fail → review with a
  field-level reason code, (6) fail → pending, (1) null → pending. Null
  confirmations = no evidence → pending (money is never verified on
  incomplete data). Pure `isPaymentPendingTimedOut()` (strictly older than
  the window; null submittedAt never times out). `verifyPayment()`:
  buyer-scoped load; `paid`/`payment_review` → 200 no-op without chain calls;
  other non-pending → 409 CLAIM_NOT_IN_PAYMENT_PENDING; missing intent →
  409 PAYMENT_INTENT_REQUIRED; RPC outside any DB transaction; effective
  confirmations = tx value, else head-minus-block fallback, else pending;
  pending past the timeout → review instead; verified/review applied in one
  locked transaction with conditional writes (concurrent verifiers fail
  closed into the winner's state). Client reasons are generic codes
  (`sender_mismatch`, `recipient_mismatch`, `amount_mismatch`,
  `data_mismatch`, `hash_mismatch`, `timeout`); specifics (expected vs
  actual) go to the server structured log only — persistent `audit_events`
  writes remain Phase 10 territory (no audit pipeline built here).
- `verify-rate-limit.ts` (new) — per-claim fixed window, 1 per 5s, with
  whole-second `Retry-After` (min 1). In-memory (same single-region standing
  note as the auth limiters). Checked only on the `payment_pending` path.
- `routes/payments.ts` — `POST /claims/:claimId/verify-payment` (buyer auth,
  strict empty body, NO per-IP limiter): advisory status pre-read scopes the
  per-claim check (state re-validated authoritatively inside the service);
  `RpcUnavailableError` → 503 RPC_UNAVAILABLE; response
  `{ data: { claim, intent, verification: { status, confirmations?, reason? } },
  requestId }`. `AppOptions` gains `rpcClient` (fake injection) and
  `rateLimit.verifyPayment` (named to avoid the auth `verify` key).
- `env.ts` + `.env.example` — `PAYMENT_REVIEW_TIMEOUT_SECONDS` (default
  1800, tolerant getter mirroring the hold TTL).
- ARCHITECTURE.md — §6 Phase 8 note + three §15 codes
  (CLAIM_NOT_IN_PAYMENT_PENDING, VERIFY_RATE_LIMITED, RPC_UNAVAILABLE).

RPC endpoint choice: primary `https://rpc.nimiqwatch.com` (free
rate-limited mainnet History node, `getTransactionByHash` verified live
2026-09-11: head ~61350304, known tx `51756c…b58b6e` returned with
`confirmations: 13`, direct `confirmations` field present). Why: documented
public access, method allowlisted, no credentials needed. Documented
fallback: set `NIMIQ_RPC_URL` to a self-hosted node (default used when
unset); on any RPC failure the server returns 503 with zero state change and
the frontend backs off — verified live below. Confirmations are taken
DIRECTLY from the RPC `confirmations` field and echoed in the response; the
head-minus-block computation exists only for the never-observed case of a
confirmation-less response (and a head-fetch failure there is also 503).

Timeout behavior: a `payment_pending` claim whose `submittedAt` is strictly
older than 1800s and whose verification would otherwise be pending moves to
`payment_review` (intent `review`) instead. Inventory is NOT restored on
review or timeout — the buyer might have paid; Phase 10 decides.

`rejected` is admin-only (Phase 10) and is NOT emitted by any Phase 8 path.
Non-pending claims 409; foreign claims 404; anonymous 401.

Frontend (`apps/web/src/`):

- `lib/api.ts` — `ApiError` carries `retryAfterMs` parsed from the
  `Retry-After` (seconds) header.
- `lib/slots.ts` — `verifyPayment()` client + `VerificationResult` type +
  pure `nextVerifyPollDelayMs()` (pending→5s, rpc-down→15s, rate-limited→
  Retry-After else 10s, verified/review→stop) with the 5s/60/15s/10s
  constants exported for tests.
- `routes/ClaimDetailPage.tsx` — `payment_pending` runs a status-only poll:
  immediate first check, then 5s cadence up to 60 auto attempts;
  `Awaiting confirmation (N/3)` when confirmations present else `Awaiting
  confirmation.`; verified/review refresh the parent (`paid` shows `Payment
  verified.`); review also shows `Payment under review. We'll be in touch.`
  (plus a dedicated `payment_review` box after reload); RPC outage shows a
  retrying notice at 15s cadence; 429 follows `Retry-After`; after 60
  attempts `Still pending. Tap to check again.` A manual `Check status`
  button is always present. The broadcast path is never retouched.

Tests (real, passing):

- Unit (`test/verify-unit.test.ts`, 21 tests, no DB): predicate per failing
  check incl. case/whitespace data and spaced-vs-canonical addresses;
  BigInt past 2^53 (equal verifies, off-by-one reviews); 2→pending,
  3/100→verified, null→pending; hash assert + case-insensitivity; timeout
  old/young/boundary/null; limiter allow/deny/header/other-claim/window;
  wire normalization incl. live-shape decode (`99847`, `You mined NIM on
  Nimiq.Space!`) and garbage→`RpcUnavailableError`; RPC URL default/override.
- Integration (`test/verify-payments.test.ts`, 14 tests, live DB, fake RPC):
  verified happy path (intent verified, claim paid, confirmations echoed);
  not-found→pending; sender/recipient/amount/data mismatch→review with
  reason codes; 2 confirmations→pending; paid/review→200 no-op with zero
  RPC calls; active_hold→409 CLAIM_NOT_IN_PAYMENT_PENDING; foreign→404 +
  anonymous→401; RPC throw→503 RPC_UNAVAILABLE with state unchanged;
  immediate second call→429 VERIFY_RATE_LIMITED + `retry-after` header;
  forced-old `submitted_at` + not-found→review with reason `timeout`.
- Live smoke (`test/nimiq-rpc-live.test.ts`, 2 tests, real network against
  the default public endpoint): known settled hash parses to the exact
  TxRecord (hash/sender/recipient/`99847`/decoded message/block 61350291/
  confirmations >= 3); head height past the known block. Passes (1.2s).

Verification (actual, via `npm.cmd`; DATABASE_URL loaded from local `.env.txt`
into the shell, value never printed):

- `run typecheck` → clean, exit 0 (api + web + shared + db).
- `run lint` → clean, exit 0.
- `run test` (live DB + live network) → api 200 pass (18 files) + web 12
  pass (2 files) + shared 1 pass, exit 0.
  (Was 163+5+1; +21 unit, +14 integration, +2 live smoke, +7 web poll.)
- `run build` → clean (api tsc; web vite 78 modules; shared tsc), exit 0.
- Live RPC smoke output: 2/2 pass (646ms + 534ms).
- Manual sequence vs built server (PORT=3108, default public RPC, REAL
  @nimiq/core wallet signatures through the production verifier, cookies in
  memory never printed, one-off Temp scripts not committed): provider
  created + published a slot; buyer claimed; intent 200
  (`expectedAmountNim: "150000"`, `expectedData: 'TAKEOVER:v1:<claimId>'`,
  claim active_hold); fake-hash submission 200 (payment_pending); POST
  verify-payment → 200 `verification: { status: 'pending' }` (fake hash
  absent on chain — real RPC default path); immediate second verify → 429
  `{"error":{"code":"VERIFY_RATE_LIMITED","message":"Verification was just
  requested. Please try again shortly."},"requestId":"…"}` with
  `retry-after=4`. Residue removed (intents 1, claims 1, slots 1, sessions
  2, users 2, challenges 2; re-query slots 0); server stopped, 0 node
  processes left.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- Verify body is strict-empty like payment-intent (unknown fields 400).
- `senderData` is not part of the binding (wallet with-data payments carry
  the message in `recipientData`; observed live). `to: null`
  (contract-creation) is a recipient mismatch → review, not a 500.
- A pending claim with a created-but-unsubmitted intent returns pending
  without an RPC call (defensive; no evidence of anything wrong).
- Rate budget is consumed before the RPC call even if the RPC then fails
  (simpler, safe direction).
- Missing `confirmations` + missing `blockNumber` → pending (never verify
  without evidence); head-fetch failure during fallback → 503.
- `retry-after` is whole seconds (min 1); fractional/HTTP-date forms are
  ignored by the web client (server always sends seconds).
- SPEC note (reported, not a conflict): ARCH s13 already listed
  verify-payment with the same semantics — implemented as specified.

Secret handling: DATABASE_URL, session secrets, and RPC credentials (none —
public endpoint, no auth) were NEVER printed in outputs, logs, or commits
(presence booleans/counts only); `.env.txt` stays gitignored; Temp drivers
printed envelopes/statuses/counts only; the audit log carries
claim/intent/tx hashes, addresses, amounts, and data (operational payment
facts, server-side only — never signatures, cookies, or keys).

Files changed (Phase 8): `apps/api/src/payments/{rpc,verify,
verify-rate-limit}.ts` (new), `apps/api/src/routes/payments.ts`,
`apps/api/src/{env.ts,payments/validation.ts}`,
`apps/api/test/{verify-unit,verify-payments,nimiq-rpc-live}.test.ts` (new),
`apps/web/src/lib/{api,slots}.ts`, `apps/web/src/routes/ClaimDetailPage.tsx`,
`apps/web/test/verify-poll.test.ts` (new), `.env.example`
(PAYMENT_REVIEW_TIMEOUT_SECONDS + RPC fallback comment), `ARCHITECTURE.md`
(§6 note + §15 codes), `AI_HANDOFF.md` (this checkpoint).

```text
CURRENT PHASE: Phase 8 complete
COMPLETED: chain-authoritative verify-payment (pending/review/verified) +
  30-min timeout to review + per-claim rate limit + polling UI
TESTS RUN: typecheck clean; lint clean; tests 200 api + 12 web + 1 shared pass
  (21 unit incl. per-check predicate/BigInt/threshold/timeout/limiter/wire,
  14 live incl. happy-path/review-matrix/no-ops/401/404/409/429/503/timeout,
  2 live-RPC smoke, 7 web poll); build clean; manual: intent 200 → submit 200
  → verify 200 pending (real RPC) → verify 429 + retry-after (residue removed)
RESULT: only a real confirmed on-chain payment flips a claim to paid; the UI
  never declares success before backend verification
KNOWN ISSUES: public RPC has no uptime guarantee (→ 503 + backoff, documented
  fallback via NIMIQ_RPC_URL); real Nimiq Pay round-trip still Phase 14
SECURITY NOTES: DATABASE_URL/session/RPC secrets never printed; browser never
  decides success; amount/recipient/sender/data always server-issued +
  chain-checked; replay guarded by UNIQUE tx_hash + claim binding; envelopes
  leak no stacks
FILES CHANGED: see list above
GIT COMMIT: feat: phase 8 payment verification against Nimiq chain
NEXT TASK: Phase 9 — Buyer/provider dashboards (do NOT start automatically)
BLOCKED BY: none
```

## Phase 7 completion — SDK return value resolution (2026-09-11)

This is a Phase 7 completion task, NOT a new phase. No block added to
IMPLEMENTATION_PLAN.md, nothing renumbered. No blockchain verification
(Phase 8), no admin flows (Phase 10), no architecture change beyond the items
below. No conflict with PROJECT_SPEC.md (FR-06's full verification list
remains Phase 8 territory; Phase 7 still records without verifying).

Step 1 — what the SDK actually returns (authoritative sources only, no
inference):

1. Installed types:
   `node_modules/@nimiq/mini-app-sdk/dist/provider.d.ts:187-193` —
   `sendBasicTransactionWithData(tx: { recipient: string; value: number;
   fee?: number; data: string; validityStartHeight?: number; }) =>
   Promise<string | ErrorResponse>` with JSDoc verbatim `@returns The
   serialized transaction` (same stale phrase on `sendBasicTransaction` at
   lines 171-181). The forwarder in
   `node_modules/@nimiq/mini-app-sdk/dist/provider.js`
   (`sendBasicTransactionWithData(e){return ...request({method:
   "sendBasicTransactionWithData",params:e})}`) just passes through whatever
   string the Nimiq Pay wallet returns.
2. Official docs:
   https://nimiq.dev/mini-apps/api-reference/nimiq-provider#sendbasictransactionwithdata
   — `sendBasicTransactionWithData` Returns `string` — transaction hash, with
   example `const txHash = await nimiq.sendBasicTransactionWithData({...})`
   (same "transaction hash" return on `sendBasicTransaction`).
3. Oracle (`@nimiq/core` 2.21.0, root devDependency):
   `node_modules/@nimiq/core/nodejs/main-wasm/index.js` — class Transaction:
   `hash()` "Computes the transaction's hash, which is used as its unique
   identifier on the blockchain. @returns {string}" vs `serialize()`
   "@returns {Uint8Array}" and `toHex()` "Serializes the transaction into a
   HEX string." Live oracle check: `TransactionBuilder.newBasic(...).hash()`
   is 64 hex chars, no `0x`; `serialize()` is 139 bytes (basic) and 214 bytes
   for a `TAKEOVER:v1:<claimId>` basic-with-data tx (428 hex chars) — a
   serialized transaction is NOT a 64-char hash. Supporting: the old
   https://github.com/nimiq-network/developer-reference/blob/master/chapters/transactions.md
   "Transaction hash" section (Blake2b over tx fields, proof excluded) and
   `Transaction.toPlain().transactionHash`.

Step 2 — resolution: Case A applies. The wallet returns a transaction hash
directly; the provider.d.ts "serialized transaction" phrase is stale
forwarder prose, contradicted by the current official docs and the
hash-vs-serialize distinction in the oracle. Format confirmed via the oracle:
64 chars, hex `[0-9a-fA-F]`, no `0x` prefix (live: lowercase 64-hex; backend
already accepts either case, rejects `0x`). A serialized transaction (278+ hex
chars basic, 428 with TAKEOVER data) would not even fit the intent of the
`txHash hex 1–256` bound for the with-data shape. No schema change, no
endpoint change. Case B's premise ("hash is Blake2b-256 of the serialized
bytes") is additionally NOT confirmed — the Rust source
(`primitives/transaction/src/lib.rs` `SerializeContent for Transaction`) hashes
content fields excluding proof/type, so no hash computation was added; per the
brief, guessing was not an option.

Frontend (`apps/web/src/lib/nimiq.ts` doc comment now cites the official URL
and records Case A; behavior unchanged — passthrough + throw on wallet
`ErrorResponse`):

- `sendBasicTransactionWithData(provider, {recipient, value, data})` returns
  the wallet string verbatim; submission posts `{ txHash: <exact string> }`.

Step 3 — frontend payment flow test, mocked SDK (the SDK path was never
exercised in Phase 7): new `apps/web/test/payment-flow.test.ts` (5 tests,
vitest, node env; `apps/web/package.json` gains `test: vitest run`,
`vitest.config.ts` + `tsconfig.json` include mirroring `apps/api` — no new
dependency, root vitest reused):

- Wallet mock returns known-good 64-hex hash (real `Transaction.hash()` shape,
  hardcoded so the web suite needs no `@nimiq/core` dep); fetch is stubbed
  for intent + submission.
- Passthrough: wrapper returns the hash unchanged; format test pins 64 hex,
  no `0x`; wallet `ErrorResponse` throws (cancel is never a silent hash).
- Full Pay click: `createPaymentIntent` → `baseUnitsToSafeNumber` →
  `sendBasicTransactionWithData` → `submitPayment`; asserts the exact bytes
  submitted equal the SDK return, `data` is byte-for-byte
  `TAKEOVER:v1:<claimId>`, `value` is the integer base-unit number (typeof
  number, `Number.isInteger`, 150000 — never float/string), `recipient` is the
  canonical intent payout. Imprecise amounts (`>MAX_SAFE_INTEGER`, zero)
  throw instead of mis-sending.

Step 4 — verification (actual, via `npm.cmd`; DATABASE_URL loaded from local
`.env.txt` into the shell, value never printed):

- `run typecheck` → clean, exit 0 (api + web + shared + db).
- `run lint` → clean, exit 0.
- `run test` (live DB) → api 163 pass (15 files, unchanged) + web 5 pass (1
  new file) + shared 1 pass, exit 0. No Case B oracle test (Case B did not
  apply).
- `run build` → clean (api tsc; web vite 78 modules; shared tsc), exit 0.
- Step 1 citations above (file paths + lines, URLs). No Step 2 oracle output
  (Case B only).

Secret handling: DATABASE_URL and session secrets were NEVER printed in
outputs, logs, or commits (presence booleans only); `.env.txt` stays
gitignored; no private keys anywhere. The mocked hash is a hardcoded test
vector, not a secret.

Files changed (Phase 7 completion): `apps/web/test/payment-flow.test.ts`
(new), `apps/web/vitest.config.ts` (new), `apps/web/package.json` (`test`
script), `apps/web/tsconfig.json` (include test), `apps/web/src/lib/nimiq.ts`
(doc comment + citation), `ARCHITECTURE.md` (§6 Case A note + citations),
`AI_HANDOFF.md` (this checkpoint + resolved note below).

```text
CURRENT PHASE: Phase 7 completion — SDK return value resolution (NOT a new phase)
COMPLETED: Case A confirmed (hash, not serialized) + mocked SDK flow test
TESTS RUN: typecheck clean; lint clean; tests 163 api + 5 web (new passthrough +
  full intent→SDK→submission incl. byte-for-byte data, integer value, canonical
  recipient) + 1 shared pass; build clean (web 78 modules)
RESULT: tx_hash semantics pinned — wallet returns the hash, frontend passes it
  through verbatim; Phase 8 can verify tx_hash against chain without a shape
  migration
KNOWN ISSUES: none new (payment_pending still has no timeout path → Phase 8/10;
  real Nimiq Pay round-trip still a Phase 14 verification item)
SECURITY NOTES: DATABASE_URL/session secrets never printed; browser still never
  decides success; recipient/amount/data still server-issued; replay still
  guarded by UNIQUE tx_hash; no rawTransaction surface added (Case B rejected)
FILES CHANGED: see list above
GIT COMMIT: chore: phase 7 completion — SDK return value resolution
NEXT TASK: Phase 8 — Real NIM payment verification (do NOT start automatically)
BLOCKED BY: none
```

Note: the frontend SDK path is now covered by a mocked test; a real Nimiq Pay
round-trip (live wallet broadcast + on-chain read) is still a Phase 14
verification item.

## Phase 7 implementation results (2026-09-11)

Buyers create a payment intent per claim and broadcast the exact NIM payment
through Nimiq Pay; the backend records the submitted hash with NO chain
verification (Phase 8). No verify-payment route (not even a stub), no admin
flows. Phase 8 NOT started.

Backend (`apps/api/src/`):

- `payments/intent-view.ts` — locked buyer projection: id, claimId,
  expectedAmountNim (STRING), expectedRecipient, expectedData, status, txHash,
  submittedAt, createdAt. No sender field anywhere in the response.
- `payments/amounts.ts` — pure `nimToBaseUnits()` (exact BigInt math).
- `payments/service.ts` — `expectedDataForClaim()` (`TAKEOVER:v1:<claimId>`,
  verbatim); `createPaymentIntent()` (payable = active_hold/payment_pending
  else 409 CLAIM_NOT_PAYABLE; existing intent returned as-is; snapshots
  amount/recipient/sender + data; unique-race backstop returns the winner);
  `submitPayment()` (expired → 409 CLAIM_EXPIRED; cancelled/other →
  CLAIM_NOT_PAYABLE; paid → CLAIM_ALREADY_PAID; no intent →
  PAYMENT_INTENT_REQUIRED; same hash → idempotent 200; different hash →
  PAYMENT_ALREADY_SUBMITTED; fresh hash stored + claim active_hold→
  payment_pending in one tx; cross-claim hash reuse caught via the UNIQUE
  index → 409). All buyer-scoped (foreign → 404); claim row locked.
- `payments/validation.ts` — strict empty intent body; txHash hex 1–256 chars.
- `routes/payments.ts` — the two POST endpoints with per-IP limiters (10/60s
  each, same mechanism as auth; overridable via AppOptions for tests).
- `app.ts` — AppOptions extended, paymentRoutes registered. `isUniqueViolation`
  exported from claims/service for reuse.
- ARCHITECTURE.md — §6 Phase 7 note + three new §15 codes (two codes from the
  brief already existed).

KNOWN GAP (deferred to Phase 8/10): a payment_pending claim with a submitted
tx hash has no timeout path — the Phase 6 sweeper only touches active_hold.
Recorded here and in ARCHITECTURE.md; no worker added per scope.

expected_sender note: intentionally absent from every buyer response — it is
server-side reconciliation data only. The buyer sees amount, recipient, and
binding data; nothing else is needed to pay.

Frontend (`apps/web/src/`, SDK used ONLY for sendBasicTransactionWithData):

- `lib/nimiq.ts` — `sendBasicTransactionWithData(provider, {recipient,
  value, data})` wrapper (wallet errors throw; nothing else added).
- `lib/slots.ts` — PaymentIntent type, intent/submission clients,
  `baseUnitsToSafeNumber()` (rejects > MAX_SAFE_INTEGER instead of
  mis-sending).
- `components/PaymentPanel.tsx` — intent-first screen (exact amount +
  destination before the wallet opens) → broadcast → record → refresh.
  Cancel → inline retry; CLAIM_EXPIRED → message + re-claim CTA;
  PAYMENT_ALREADY_SUBMITTED → refresh into pending; any post-broadcast
  recording failure → persistent "broadcast but not recorded, do not retry"
  warning (never auto-retries payment).
- `routes/ClaimDetailPage.tsx` — active_hold → panel + countdown; pending →
  submitted box (hash via idempotent intent read, frozen deadline,
  later-phase note); expired → hold-ended + re-claim CTA; paid → verified
  placeholder.

SDK report (verified against installed @nimiq/mini-app-sdk/dist/provider.d.ts,
NOT improvised): `sendBasicTransactionWithData({recipient, value, fee?,
data, validityStartHeight?}) => Promise<string | ErrorResponse>` — the
assumed call shape matches. Two deviations recorded: (1) `value` is typed
`number`, so the exact base-unit string is validated with BigInt then guarded
to a safe integer before the call; (2) the doc comment calls the returned
string "the serialized transaction", NOT explicitly a tx hash — Phase 7
records it verbatim as txHash per the brief, and Phase 8 MUST resolve its
true semantics against a real wallet before verifying anything. `data` is a
plain string: the exact binding is passed verbatim, no manual encoding.
RESOLVED by the Phase 7 completion checkpoint above (Case A): the official
docs (https://nimiq.dev/mini-apps/api-reference/nimiq-provider#sendbasictransactionwithdata,
Returns `string` — transaction hash) plus the @nimiq/core hash-vs-serialize
oracle pin the return as a 64-hex hash, no `0x`; no schema/endpoint change.

Tests (real, passing):

- Unit (`test/payments-unit.test.ts`, 8 tests, no DB): exact data format +
  case/whitespace; NIM→base exact incl. 0.00001→1 and >2^53 (plus invalid
  shapes); txHash accept/reject matrix incl. unknown-field rejection.
- Integration (`test/payments.test.ts`, 14 tests, live DB, stub-verifier auth,
  per-run tags, batched cleanup): intent create (claim untouched) + repeat
  same-id + 401 + foreign-404 + expired-409; submit 200 (submitted + pending)
  + no-intent 409 + same-hash idempotent + cross-claim reuse 409 (UNIQUE
  enforced) + different-hash 409 + expired/paid/auth/foreign branches +
  locked projection keys with string amount, exact data, no sender field.

Verification (actual, via `npm.cmd`; DATABASE_URL loaded from local `.env.txt`
into the shell, value never printed):

- `run typecheck` → clean, exit 0.
- `run lint` → clean, exit 0.
- `run test` (live DB) → api 163 pass (15 files) + shared 1 pass, exit 0.
  (Was 141+1; +8 unit, +14 integration.)
- `run build` → clean (api tsc; web vite; shared tsc), exit 0.
- Manual sequence vs built server (PORT=3106; REAL @nimiq/core wallet
  signatures through the production verifier; cookies in memory, never
  printed; one-off Temp scripts, not committed): provider created + published
  a slot; buyer claimed; POST payment-intent → 200 with
  `expectedData: 'TAKEOVER:v1:<claimId>'`, `expectedAmountNim: "150000"`,
  claim still active_hold; POST payment-submission with an unverified fake
  64-hex hash → 200 (record-only, as designed); GET claim → payment_pending.
  Residue removed afterwards (users removed: 2); server stopped, port free,
  no node residue.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- Missing slot on intent/submit → 404 NOT_FOUND (existing convention);
  missing/foreign claim reads → 404 CLAIM_NOT_FOUND (the locked home).
- Amount-math tests live in the api suite: apps/web has no test runner, so
  the web sell-form helper keeps its identical logic untested while the
  tested reference lives in `payments/amounts.ts`. Shared package left as
  placeholder-only per the fixed architecture.
- Corrupt stored payout/sender (fails canonicalization) → 500: client did
  nothing wrong, server data invariant broke. Seed fixture payouts would hit
  this — seed data is disposable and never runs in prod.
- Duplicate-claim check on the submission path is unnecessary: submission
  requires one specific claim id.
- No rate limits invented beyond the brief's per-IP parity with auth (10/60s
  defaults; tests override).
- SPEC note (reported, not a conflict): FR-06's full verification list is
  Phase 8 territory; Phase 7 records without verifying, exactly as briefed.

Secret handling: DATABASE_URL and session secrets were NEVER printed in
outputs, logs, or commits (key names + boolean presence/counts only);
`.env.txt` stays gitignored; Temp drivers printed envelopes/statuses only.

Files changed (Phase 7): `apps/api/src/payments/{intent-view,amounts,service,
validation}.ts` (new), `apps/api/src/routes/payments.ts` (new),
`apps/api/src/{app.ts,claims/service.ts}` (export + wiring),
`apps/api/test/{payments-unit,payments}.test.ts` (new),
`ARCHITECTURE.md` (§6 note + §15 codes), `apps/web/src/lib/{slots,nimiq}.ts`,
`apps/web/src/components/PaymentPanel.tsx` (new),
`apps/web/src/routes/ClaimDetailPage.tsx`, `AI_HANDOFF.md` (this checkpoint).

```text
CURRENT PHASE: Phase 7 complete
COMPLETED: intent creation (idempotent, exact binding) + record-only submission
  + real Nimiq Pay broadcast UI with broadcast-loss guard
TESTS RUN: typecheck clean; lint clean; tests 163 api + 1 shared pass (8 unit
  incl. exact data/BigInt math/hash matrix, 14 live incl. idempotency, replay
  guard, all 409 branches, locked projection); build clean; manual sequence:
  intent 200 (exact binding, string amount) → fake-hash submit 200 (record-only)
  → claim payment_pending (residue removed)
RESULT: buyers see exact server-generated payment terms and can broadcast;
  nothing is verified yet — that is Phase 8
KNOWN ISSUES/GAPS: payment_pending has no timeout path (→ Phase 8/10); SDK
  return-string semantics unresolved until a real wallet is exercised (→ Phase 8)
SECURITY NOTES: DATABASE_URL/session secrets never printed; browser never
  decides success; recipient/amount/data always server-issued; replay guarded
  by UNIQUE tx_hash; envelopes leak no stacks
FILES CHANGED: see list above
GIT COMMIT: feat: phase 7 payment intents and submission
NEXT TASK: Phase 8 — Real NIM payment verification (do NOT start automatically)
BLOCKED BY: none
```

## Phase 6 completion — FR-05 reconciliation (2026-09-11)

1. Hold TTL 900s → 600s (10 minutes, FR-05): `DEFAULT_CLAIM_HOLD_TTL_SECONDS`
   in `apps/api/src/env.ts`, `.env.example` comment, unit-test defaults and
   fallback expectations, integration hold-span bounds (599_999–600_001ms),
   ARCHITECTURE.md §7 note. Env override (`CLAIM_HOLD_TTL_SECONDS`) and the
   tolerant getter are unchanged.

2. Duplicate claims idempotent-return instead of 409-reject: POST
   /api/v1/slots/:slotId/claims now returns 200 with the buyer's existing
   live claim (active_hold/payment_pending/payment_review) and the current
   slot state — same shape as a fresh claim, no second row, no decrement.
   The existing-claim check runs before the eligibility check inside the
   locked transaction; the unique-violation backstop now re-reads and returns
   the winner instead of 409ing. SLOT_ALREADY_CLAIMED is removed — it is no
   longer emitted anywhere (verified by grep; only this historical note and
   the old Phase 6 section mention it). The Phase 2 partial unique index is
   untouched and remains the DB-level backstop.

Tests (real, passing):

- Replaced the 409 duplicate test with: second POST → 200, SAME claim ID,
  status active_hold, same slot shape, available_quantity untouched (4),
  exactly one claim row.
- New: pre-inserted payment_pending hold → POST returns 200 with that claim
  ID and status, stock untouched.
- New: same buyer, two concurrent POSTs → both 200, same claim ID, exactly
  one claim row, single decrement.
- Kept as-is: the N-different-buyers race (exactly one wins) — still passes,
  proving the lock still serializes distinct buyers.

Verification (actual, via `npm.cmd`; DATABASE_URL loaded from local `.env.txt`
into the shell, value never printed):

- `run typecheck` → clean, exit 0.
- `run lint` → clean, exit 0.
- `run test` (live DB) → api 141 pass (13 files) + shared 1 pass, exit 0.
  (Was 139+1; +2 net: replaced 1 test with 3.)
- `run build` → clean (api tsc; web vite; shared tsc), exit 0.

```text
CURRENT PHASE: Phase 6 completion — FR-05 reconciliation (NOT a new phase)
COMPLETED: 600s TTL default; idempotent duplicate-claim returns; code removed
TESTS RUN: typecheck clean; lint clean; tests 141 api + 1 shared pass (same-ID
  return, no redecrement, payment_pending return, concurrent same-buyer single
  row, N-buyer race unchanged); build clean
RESULT: spec FR-05 reconciled — 10-minute holds, duplicates return the hold
KNOWN ISSUES: none
SECURITY NOTES: DATABASE_URL/session secrets never printed; no new auth or
  payment surface; unique index untouched
FILES CHANGED: apps/api/src/{env.ts,claims/service.ts}, .env.example,
  apps/api/test/{claims-unit,claims}.test.ts, ARCHITECTURE.md (§7 note),
  AI_HANDOFF.md (this checkpoint)
GIT COMMIT: chore: phase 6 completion — FR-05 reconciliation
NEXT TASK: Phase 7 — NIM payment intent (do NOT start automatically)
BLOCKED BY: none
```

## Phase 6 implementation results (2026-09-11)

Buyers atomically claim published slots; holds expire lazily and restore
inventory exactly once. No money moves: no intents, no verification, no
admin, no transaction sending. No architecture change. Phase 7 NOT started.

Backend (`apps/api/src/`):

- `env.ts` + `.env.example` — CLAIM_HOLD_TTL_SECONDS (default 900 = 15 min)
  via tolerant `getClaimHoldTtlSeconds()` (blank/invalid → default).
- `claims/claim-view.ts` — buyer projection: id, slot_id, buyer_id, quantity,
  status, hold_expires_at, claimed_at, updated_at.
- `claims/service.ts` — pure `isClaimEligible()` (status ∈ {published,
  sold_out} + future start + stock) and `isHoldExpired()` mirrors;
  `createClaim()` (SELECT … FOR UPDATE via drizzle `.for('update')`,
  eligibility → 409 SLOT_UNAVAILABLE, live-claim check + unique-violation
  backstop → 409 SLOT_ALREADY_CLAIMED, insert hold qty 1, conditional
  decrement, sold_out flip at 0); `expireHoldsForSlot()` (expire past-due
  active_hold → guarded increment capped at total → sold_out→published flip,
  all in one tx); `getClaimForBuyer()` (buyer-scoped, null → 404);
  `listBuyerClaims()` (buyer-scoped, claimed_at DESC).
- `claims/validation.ts` — empty-but-strict claim body, uuid claim id,
  my-claims query (status enum + limit/offset).
- `routes/claims.ts` — POST /slots/:slotId/claims (200 {claim, slot}; expiry
  sweep first), GET /claims/:claimId (404 CLAIM_NOT_FOUND), GET /me/claims
  (sweeps the buyer's stale slots first, then lists).
- `routes/slots.ts` — GET /slots/:slotId runs the slot's expiry sweep before
  returning (public and owner paths alike).
- `slots/service.ts` — public filter widened to status IN (published,
  sold_out), list and detail. Starts_at > now() unchanged.

Phase 4 filter change (required, why): sold_out is now a live lifecycle state
that flips back to published when holds expire, so hiding it would show stale
"gone" state and hide restocked openings. Sold-out rows stay visible with the
existing sold-out badge; detail works for both. Documented in ARCHITECTURE.md
§7 Phase 6 note; Phase 4 suite updated (sold_out now expected in list/detail,
all other exclusions unchanged).

Confirmed: the 'expired' SLOT status is set by no Phase 6 path (only claims
rows expire; verified by grep — 'expired' writes exist solely for
claims.status). Claim quantity is fixed at 1 (CLAIM_QUANTITY; no multi-unit
path). No cron/workers — expiry is lazy on the three locked read paths only.

Frontend (`apps/web/src/`, no Nimiq SDK in any Phase 6 file):

- `lib/slots.ts` — ClaimView, createClaim/fetchClaim/fetchMyClaims.
- Components: ClaimButton (auth-only, claimable-only; navigates to the new
  claim; 409 shows inline), ClaimStatusBadge, HoldCountdown (1s tick, clamps
  at zero), ClaimCard (status + countdown + links, no invented fields).
- Routes: `/slot/:slotId` gains the button for signed-in buyers on live
  openings (guests see a connect hint); `/claim/:claimId` (badge, countdown,
  opening summary, "payment coming next step" placeholder — no payment UI);
  `/claims` (own holds, status filter). Both claim routes RequireAuth-guarded
  (server still enforces 401/404). TopBar gained a Claims link.

Tests (real, passing):

- Unit (`test/claims-unit.test.ts`, 8 tests, no DB): TTL default/configured/
  invalid; eligibility matrix (statuses × past/now/future × stock);
  expiry predicate (past-deadline holds only).
- Integration (`test/claims.test.ts`, 19 tests, live DB, stub-verifier auth,
  per-run tags, batched cleanup): 8-buyer race on 1 unit → exactly one 200,
  seven 409 SLOT_UNAVAILABLE, avail 0 + sold_out + single claim row; claim →
  200 + exact 900s hold + decrement; final-unit flip; sold_out/draft/
  cancelled/past → 409; missing slot → 404; double claim → 409 with stock
  untouched; 401 anonymous; own-claim 200 {claim, slot}; other's → 404
  CLAIM_NOT_FOUND; claim-detail 401 anonymous; me/claims isolation + status
  filter; expiry via detail (expired + restored); sold_out→published flip;
  double-sweep and parallel-sweep exactly-once; sold_out in public list.

Verification (actual, via `npm.cmd`; DATABASE_URL loaded from local `.env.txt`
into the shell, value never printed):

- `run typecheck` → clean, exit 0.
- `run lint` → clean, exit 0.
- `run test` (live DB) → api 139 pass (13 files) + shared 1 pass, exit 0.
  (Was 111+1; +8 unit, +19 integration, +1 sold_out detail test in the
  updated Phase 4 suite. Phase 4/5 suites otherwise unmodified and passing.)
- `run build` → clean (api tsc; web vite 77 modules; shared tsc), exit 0.
- Manual race vs built server (PORT=3105; three REAL @nimiq/core wallet
  signatures through the production verifier; cookies in memory, never
  printed; one-off Temp scripts, not committed): provider created + published
  a 1-unit slot; parallel claims → A 200 (active_hold, slot sold_out/avail 0),
  B 409 `{"error":{"code":"SLOT_UNAVAILABLE","message":"This slot is no longer
  available."},"requestId":"…"}`; GET slot → 200 sold_out, avail 0.
- Manual expiry: hold forced past via SQL → GET detail → 200 published,
  avail 1, claim row `["expired"]`. Residue removed afterwards (slot 1,
  users 2 via targeted deletes; one extra recent orphan swept, re-sweep 0);
  server stopped, port free, no node residue.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- POST claims returns 200 (per the locked test expectation).
- Missing slot on claim → 404 NOT_FOUND; missing/foreign claim → 404
  CLAIM_NOT_FOUND (the locked home for that code).
- Duplicate check covers the full live set (active_hold/payment_pending/
  payment_review) mirroring the partial index; only active_hold can exist yet.
- Missing claim body accepted ({} default); unknown fields rejected.
- me/claims items are bare claim views (no embedded slot — the brief lists
  {claims, total, limit, offset} only); cards link to claim/opening pages.
- GET /claims/:claimId runs no expiry (brief names three paths only);
  countdown clamps at zero for stale views.
- Owners may claim their own slots (no restriction in the brief — allowed,
  not invented as a rule).
- Disabled buyers → 401 via existing session middleware (no extra code).
- TTL is read per request through the tolerant getter.
- No rate limits on the new endpoints (standing Phase 12 note).
- SPEC note (reported, not a conflict): FR-05 sketches a 10-min hold and
  idempotent duplicate returns; the locked Phase 6 brief governs — 15-min
  TTL (env-overridable) and 409 SLOT_ALREADY_CLAIMED rejects.

Secret handling: DATABASE_URL and session secrets were NEVER printed in
outputs, logs, or commits (key names + boolean presence/counts only);
`.env.txt` stays gitignored; Temp drivers printed envelopes/statuses only.

Files changed (Phase 6): `apps/api/src/claims/{claim-view,service,
validation}.ts` (new), `apps/api/src/routes/claims.ts` (new),
`apps/api/src/{env.ts,app.ts,routes/slots.ts,slots/service.ts}`,
`apps/api/test/{claims-unit,claims}.test.ts` (new),
`apps/api/test/slots.test.ts` (sold_out visibility updates),
`ARCHITECTURE.md` (§7 Phase 6 note), `.env.example`
(CLAIM_HOLD_TTL_SECONDS), `apps/web/src/lib/slots.ts`,
`apps/web/src/components/{ClaimButton,ClaimStatusBadge,HoldCountdown,
ClaimCard}.tsx` (new), `apps/web/src/routes/{ClaimDetailPage,ClaimsPage}.tsx`
(new), `apps/web/src/{App.tsx,routes/SlotDetailPage.tsx,
components/TopBar.tsx}`, `AI_HANDOFF.md` (this checkpoint).

```text
CURRENT PHASE: Phase 6 complete
COMPLETED: atomic claims + sold_out lifecycle + lazy idempotent expiry + claim UI
TESTS RUN: typecheck clean; lint clean; tests 139 api + 1 shared pass (8 unit
  incl. TTL/eligibility/expiry matrices, 19 live incl. 8-way race exactly-once,
  double + parallel sweep exactly-once, flip both directions); build clean;
  manual race: 200 + 409 live (sold_out/avail 0); manual expiry: published/
  avail 1 + claim expired (residue removed)
RESULT: one buyer wins the final unit, always; expired holds restore stock
  exactly once; buyers see holds, countdowns, and history
KNOWN ISSUES: none functional (rate limits deferred to Phase 12, noted above)
SECURITY NOTES: DATABASE_URL/session secrets never printed; row lock + partial
  unique index both enforced; foreign claims 404 (never 403); envelopes clean
FILES CHANGED: see list above
GIT COMMIT: feat: phase 6 atomic claims and hold expiry
NEXT TASK: Phase 7 — NIM payment intent (do NOT start automatically)
BLOCKED BY: none
```

## Phase 5 implementation results (2026-09-11)

Authenticated providers can create drafts, edit drafts, publish, cancel, and
list their own slots. No claims/payment/admin logic beyond reading claim
statuses for the cancel gate; no transaction sending. No architecture change.
Public Phase 4 discovery preserved (its suite still passes unmodified).
Phase 6 NOT started.

Backend (`apps/api/src/`):

- `slots/owner-slot.ts` — locked owner projection: public fields +
  payout_wallet (never provider_id or internals).
- `slots/validation.ts` — strict Zod bodies (create required, patch partial,
  me/slots query, uuid params); pure `validatePublishable()` (per-field
  failures); `canonicalizePayoutWallet()` (400 incl. bad checksum); pure state
  guards `requireDraftForEdit` (409 SLOT_NOT_EDITABLE),
  `requireDraftForPublish` (409 SLOT_NOT_PUBLISHABLE),
  `requireCancellableStatus` (409 SLOT_NOT_CANCELLABLE).
- `slots/lifecycle.ts` — createSlot (draft, available=total, role untouched),
  updateDraftSlot (draft-only, conditional write), publishSlot (re-validates
  stored row, conditional draft→published in tx), cancelSlot (blocks on
  payment_pending/paid/payment_review claims; releases active_hold→cancelled
  and cancels the slot in one tx), listOwnSlots (owner-scoped, created DESC).
  Non-owned access → 404 everywhere; no session → 401.
- `routes/slots.ts` — POST /slots (201), PATCH /slots/:slotId,
  POST /slots/:slotId/publish, POST /slots/:slotId/cancel, GET /me/slots
  (status/limit/offset); GET /slots/:slotId extended: public projection when
  published+future, else owner projection for the authenticated owner, else
  404 (anonymous draft still 404 — Phase 4 test untouched and passing).

MVP restriction (stricter than ARCH "commercial fields immutable"): published
slots cannot be edited at all — PATCH on any non-draft is 409. Cancel needs
draft/published plus no blocking claims. `expired` is never set in Phase 5
(public list already excludes past starts_at); `sold_out` is never set in
Phase 5 (Phase 6 owns it when available hits 0). No cron/workers.

Seed fixture note: `NQ00 SEEDPAYOUT…` / `NQ00 SEEDFIXTURE…` are NOT valid
Nimiq addresses (broken checksum by design) and CANNOT be used with the
create/publish API — 400 INVALID_INPUT, proven by test. They exist only as
Phase 4 seed data.

Frontend (`apps/web/src/`, no Nimiq SDK in any Phase 5 file):

- `lib/slots.ts` — OwnerSlot, my-slots + create/patch/publish/cancel clients,
  `parseNimToBaseUnits()` (NIM decimal ≤5dp → exact base-unit string).
- Components: SlotForm (draft create/edit, NIM price entry, inline +
  server errors), StatusBadge, PublishButton, CancelConfirmDialog,
  RequireAuth (waits for first session check, guests → `/`).
- Routes: `/sell` (own slots, all statuses, status filter, create entry),
  `/sell/new` (create → lands on `/sell/:id`), `/sell/:slotId` (draft: edit
  + publish + cancel; published: read-only + payout line + cancel; others:
  read-only). `store/auth` gained an `initialized` flag (no other behavior
  change). TopBar gained a Sell link. Mobile-first, consumer language.

Tests (real, passing):

- Unit (`test/slots-lifecycle-unit.test.ts`, 8 tests, no DB): each publish
  field failing alone; SEED payout rejected with 400/INVALID_INPUT, valid
  address canonicalized; edit/publish/cancel guards across all five statuses.
- Integration (`test/slots-lifecycle.test.ts`, 18 tests, live DB, stub-verifier
  auth flow, per-run tags, batched cleanup): 401 without auth; create → draft
  + available==total + published_at null + role stays buyer; bad payout → 400;
  patch own draft ok; patch other's → 404; patch published → 409; publish ok
  (status + published_at); re-publish → 409; publish other's → 404; cancel
  draft ok; cancel published releases active_hold→cancelled; paid claim → 409;
  payment_pending claim → 409; cancel other's → 404; me/slots isolation +
  payout_wallet present; owner draft detail 200 with payout_wallet; anonymous
  draft detail 404.

Verification (actual, via `npm.cmd`; DATABASE_URL loaded from local `.env.txt`
into the shell, value never printed):

- `run typecheck` → clean, exit 0.
- `run lint` → clean, exit 0.
- `run test` (live DB) → api 111 pass (11 files) + shared 1 pass, exit 0.
  (Was 85+1; +8 unit, +18 integration. Phase 4 suites unmodified, passing.)
- `run build` → clean (api tsc; web vite 71 modules; shared tsc), exit 0.
- Manual HTTP sequence vs built server (PORT=3104; auth via a REAL
  @nimiq/core wallet signature through the production verifier; session cookie
  held in memory, never printed; one-off Temp scripts, not committed):
  POST /slots → 201 draft envelope (available 2/2, published_at null,
  payout owner wallet); PATCH → 200 (title edited); POST publish → 200
  (published + published_at); PATCH → 409
  `{"error":{"code":"SLOT_NOT_EDITABLE","message":"Only draft slots can be edited."},"requestId":"…"}`;
  POST cancel → 200 (cancelled). Residue removed afterwards
  (slots removed: 1, users removed: 1); server stopped, port free, no node
  residue.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- POST /slots returns 201 (other POSTs in this codebase use 200; create uses
  REST 201 — asserted in tests).
- Create/patch validate shapes only (draft is a scratchpad); semantic gates
  run at publish against the stored row. Malformed UUID → 400.
- PATCH total_quantity on a draft resets available_quantity = total (drafts
  hold no demand). Empty PATCH body is a no-op 200.
- Publish 400 names failing fields (`invalid starts_at, …`).
- State changes use conditional WHERE writes inside transactions so races
  fail closed (second publisher/canceller gets 409, not a silent overwrite).
- me/slots sorts created_at DESC (management view, newest first).
- No rate limits added to the new endpoints (same standing note as Phase 4:
  deferred to the Phase 12 security pass).
- SPEC note (reported, not a conflict): FR-03 sketches broader required
  fields and DRAFT-or-PUBLISHED creation; the locked Phase 5 brief governs —
  create takes the five required fields and always yields draft, and publish
  enforces completeness (title, future start, ends-after-start, price, qty,
  valid payout). Category/description stay optional per the locked brief.

Secret handling: DATABASE_URL and session secrets were NEVER printed in
outputs, logs, or commits (key names + boolean presence/counts only);
`.env.txt` stays gitignored; seed fixtures remain auth-rejected.

Files changed (Phase 5): `apps/api/src/slots/{owner-slot,validation,
lifecycle}.ts` (new), `apps/api/src/routes/slots.ts`,
`apps/api/test/{slots-lifecycle-unit,slots-lifecycle}.test.ts` (new),
`apps/web/src/lib/slots.ts`, `apps/web/src/store/auth.ts`,
`apps/web/src/components/{SlotForm,StatusBadge,PublishButton,
CancelConfirmDialog,RequireAuth}.tsx` (new),
`apps/web/src/routes/{Sell,SellNew,SellDetail}.tsx` (new),
`apps/web/src/{App.tsx,components/TopBar.tsx}`, `AI_HANDOFF.md` (this
checkpoint).

```text
CURRENT PHASE: Phase 5 complete
COMPLETED: draft create/edit, publish, cancel, owner detail + my-slots, sell UI
TESTS RUN: typecheck clean; lint clean; tests 111 api + 1 shared pass (8 unit
  incl. per-field publish + SEED rejection + all-status guards, 18 live
  lifecycle incl. 401/404/409s, cancel gates, isolation); build clean;
  manual sequence: 201 draft → 200 patch → 200 publish → 409 patch →
  200 cancel (real-signature auth, envelopes captured, residue removed)
RESULT: providers own their full draft→published→cancelled loop; buyers see
  no change; no unpublished/private data leaks
KNOWN ISSUES: none functional (rate limits deferred to Phase 12, noted above)
SECURITY NOTES: DATABASE_URL/session secrets never printed; non-owned slots
  404 (never 403); LIKE escaping retained; envelopes leak no stacks
FILES CHANGED: see list above
GIT COMMIT: feat: phase 5 provider slot lifecycle
NEXT TASK: Phase 6 — Claims and concurrency (do NOT start automatically)
BLOCKED BY: none
```

## Phase 4 implementation results (2026-09-11)

Public read-only marketplace: seed data, list + detail endpoints, buyer
discovery UI. No slot creation/publishing, claims, payments, admin, or Nimiq
transaction sending. No architecture change. Phase 5 NOT started.

Backend (`apps/api/src/`):

- `slots/price.ts` — `serializePriceNim()` (bigint/string/number → exact
  decimal string; rejects zero/negative/non-integer/unsafe numbers).
- `slots/public-slot.ts` — locked projection: id, title, description,
  category, location_label, starts_at, ends_at, price_nim (STRING),
  total_quantity, available_quantity, status, published_at. Never
  payout_wallet, provider_id, or internal columns.
- `slots/service.ts` — `buildPublicSlotConditions()` (base: status =
  published AND starts_at > now, strict `>`; q ilike over title/description/
  location_label with LIKE-escaping; category exact; location ilike; from/to
  bounding starts_at), `listPublicSlots()` (starts_at ASC + count),
  `getPublicSlotById()`, pure `isStartInFuture()` boundary helper.
- `routes/slots.ts` — GET /slots (limit dflt 20/max 50, offset dflt 0, q,
  category, location, from/to ISO; strict schema, unknown params → 400) and
  GET /slots/:slotId (malformed UUID → 400; valid but non-published → 404,
  same as missing — no existence leak). No auth. Enveloped 400/404/500.
- `app.ts` — registered `slotRoutes` under /api/v1 alongside authRoutes.

Seed (`db/seed.ts`, `npm run db:seed`): refuses production (non-zero exit +
clear message); 5 fixture providers + 21 slots (15 published future incl. one
with 0 left for the sold-out UI; 2 draft, 1 cancelled, 2 expired-past, 1
sold_out); fixed UUIDs + onConflictDoNothing (re-run never duplicates; does
not update edited rows). Times relative to now (today/tonight/tomorrow/this
week/next week). Prices in integer base units, quantities varied.

Fixture wallet pattern (so Phase 5+ knows what to ignore): providers
`NQ00 SEEDFIXTURE00000000000X`, payouts `NQ00 SEEDPAYOUT00000000000X`. The
`SEED…` marker breaks the IBAN checksum, so auth canonicalization always
rejects them — no seed user can ever log in. No real wallets, no PII.

Frontend (`apps/web/src/`, no Nimiq SDK in any Phase 4 file):

- `lib/slots.ts` — PublicSlot type, fetchSlots/fetchSlot (URLSearchParams,
  empties dropped), formatNim() (exact BigInt math, 1 NIM = 100,000 base units).
- Components: SearchFilters (labeled, URL-driven), SlotCard, SlotList,
  SlotDetail (WHAT/WHEN/WHERE/HOW MUCH/HOW MANY LEFT, no Claim button),
  PriceDisplay, TimeBadge (Today/Tomorrow/date), AvailabilityBadge (text, never
  color alone), EmptyState, LoadingSkeleton, ErrorState.
- Routes: `/` marketplace feed (filters in URL = deep-linkable; offset in
  component state; Show-more pagination; result count "soonest first");
  `/slot/:slotId` detail (loading/error/not-found/sold-out states; 404 →
  "no longer available"). AppShell/TopBar/WalletStatus reused untouched.
  Mobile-first, consumer language, no crypto jargon.

Tests (real, passing):

- Unit (`test/slots-unit.test.ts`, 9 tests, no DB): bigint→string incl.
  >2^53 exactness; string/number paths; zero/negative/garbage rejection;
  filter builder 2 base conditions when empty, +1 per present filter; LIKE
  escaping; boundary equal→excluded, ±1ms.
- Integration (`test/slots.test.ts`, 10 tests, live DB, unique per-run tag):
  list only published+future; soonest-first sort; q + category filters;
  limit=51 → 400; limit/offset pagination + total; exact projection keys with
  price string and no privates; detail 200 correct; 404 draft/cancelled/
  expired/sold_out/past; 404 random UUID; requestId on list/detail/404.

Verification (actual, via `npm.cmd`; DATABASE_URL loaded from local `.env.txt`
into the shell, value never printed):

- `run typecheck` → clean, exit 0.
- `run lint` → clean (after removing one unused const + one unneeded
  eslint-disable in Home.tsx), exit 0.
- `run test` (live DB) → api 85 pass (9 files) + shared 1 pass, exit 0.
  (Was 66+1; +9 unit, +10 integration.)
- `run build` → clean (api tsc; web vite 63 modules; shared tsc), exit 0.
- `run db:seed` → twice, both `seed users ok (5 fixture providers)` /
  `seed slots ok (21 fixture slots)`, exit 0 both.
- Live built server (PORT=3103, stopped afterwards, port free):
  GET /api/v1/slots?limit=3 → 200, total 15, 3 published slots, price_nim
  JSON strings, no payout_wallet, requestId present.
  GET /api/v1/slots/22222222-2222-4222-8222-000000000001 → 200 correct slot.
  GET /api/v1/slots/22222222-2222-4222-8222-000000000016 (draft) → 404
  `{"error":{"code":"NOT_FOUND","message":"Slot not found."},"requestId":"…"}`.

IMPLEMENTATION DETAILS — AGENT DECIDED (locked scope preserved):

- limit > 50 is REJECTED with 400 INVALID_INPUT, not silently clamped.
- Malformed slot UUID → 400; valid-but-hidden UUID → 404.
- Empty query values (`?q=`) behave as absent (clearing a filter is a no-op).
- Sold-out UI keys off `available_quantity === 0` on published rows; status
  `sold_out` rows stay hidden by the published-only rule.
- No rate limit added to the public read path (ARCH s14 lists one as future
  config; deferred to the Phase 12 security pass — reported, not decided).
- SPEC/ARCH note (reported, not a conflict): ARCH s13 sketches geo/sort/page
  params (city/lat/lng/sort/page/pageSize); Phase 4 implements exactly the
  locked contract (limit/offset/q/category/location/from/to, starts_at ASC).
  Geo/sort extensions are future scope, not added.

Secret handling: DATABASE_URL and session secrets were NEVER printed in
outputs, logs, or commits (key names + boolean presence only); `.env.txt`
stays gitignored; seed contains only fixture wallets (unusable for auth).

Files changed (Phase 4): `apps/api/src/slots/{price,public-slot,service}.ts`
(new), `apps/api/src/routes/slots.ts` (new), `apps/api/src/app.ts`,
`db/seed.ts` (new), `db/tsconfig.json`, `package.json` (db:seed),
`apps/web/src/lib/slots.ts` (new),
`apps/web/src/components/{SearchFilters,SlotCard,SlotList,SlotDetail,
PriceDisplay,TimeBadge,AvailabilityBadge,EmptyState,LoadingSkeleton,
ErrorState}.tsx` (new), `apps/web/src/routes/{Home.tsx,SlotDetailPage.tsx}`,
`apps/web/src/App.tsx`, `apps/api/test/{slots-unit,slots}.test.ts` (new),
`AI_HANDOFF.md` (this checkpoint).

```text
CURRENT PHASE: Phase 4 complete
COMPLETED: seed data + public list/detail endpoints + discovery UI
TESTS RUN: typecheck clean; lint clean; tests 85 api + 1 shared pass (9 unit
  incl. >2^53 price + boundary, 10 live marketplace incl. exclusion/filters/
  pagination/projection/404s); build clean; db:seed twice ok; live curls:
  list envelope 200 (15 total), detail 200, draft 404 envelope
RESULT: buyer can browse real DB-backed slots; no unpublished/private data leaks
KNOWN ISSUES: none functional (rate limits deferred to Phase 12, noted above)
SECURITY NOTES: DATABASE_URL/session secrets never printed; seed wallets are
  auth-rejected fixtures; LIKE wildcards escaped; envelopes leak no stacks
FILES CHANGED: see list above
GIT COMMIT: feat: phase 4 marketplace discovery
NEXT TASK: Phase 5 — Provider slot creation and lifecycle (do NOT start automatically)
BLOCKED BY: none
```

## Phase 3 completion results (2026-09-11)

This is a Phase 3 completion checkpoint — NOT a new phase. No slot lifecycle,
claims, payments, admin, or Nimiq transaction sending was added. No
architecture change beyond the items below. Phase 4 NOT started.

Step 1 outcome: CONFIRMED (with two corrections to the uncommitted partial work;
the test was NOT weakened — it remains non-circular: all keys, addresses,
hashes, and oracle signatures are produced by @nimiq/core; production code
only consumes/verifies them).

- Step 0: `npm.cmd install` ok; oracle initially FAILED (2 defects in partial
  work), then fixed:
  1. Syntax typo `expect(HUB_PREFIX).to haveLength(23)` → `toHaveLength(23)`.
  2. Reverse cross-check used non-existent `new Signature(bytes)` (the real
     @nimiq/core v2.21.0 `Signature` has no byte constructor — it exposes
     `static create/deserialize`) causing `null pointer passed to rust` in
     `PublicKey.verify`. Fixed ambient typing
     (`apps/api/src/types/nimiq-core.d.ts`) to `static deserialize` and test to
     `Signature.deserialize(mine)`. Forward direction
     (`Signature.create` → `verifyNimiqSignature`) already passed.
  Result after fix: `test/nimiq-oracle.test.ts` 4/4 pass.
- Citation (verified 2026-09-11, both confirmed):
  URL: https://nimiq.github.io/api-reference/sign-message — "Prefixing and
  Hashing" defines `sign( sha256( '\x16Nimiq Signed Message:\n' +
  message.length + message ) )`; "Verification" points at the core library.
  File paths in the installed oracle (@nimiq/core 2.21.0):
  `node_modules/@nimiq/core/nodejs/main-wasm/index.js` (`Signature.create` /
  `PublicKey.verify(signature, data)` / `Hash.computeSha256` /
  `KeyPair.generate`, `PublicKey` byte constructor, `toAddress`) and
  `node_modules/@nimiq/core/lib/node/index.js` (`BufferUtils.fromUtf8`).
  Note: the envelope literal itself lives only in the Hub docs
  (`HubApi.MSG_PREFIX`); @nimiq/core provides the oracle primitives, not the
  literal — no `Nimiq Signed Message` string exists in @nimiq/core.
- Envelope: `sha256('\x16Nimiq Signed Message:\n' + len + message)`, 23-byte
  prefix pinned byte-for-byte. Production verification is tweetnacl +
  @noble/hashes + Node crypto only; @nimiq/core is a root devDependency used
  exclusively as the test oracle (`apps/api/test/nimiq-oracle.test.ts`),
  never imported by production code. Documented in ARCHITECTURE.md s4.5.
- Also removed stray `apisrctypesnimiq-core.d.ts` (contained git-diff text,
  broke `npm run lint`).

Cookie config (locked Vercel frontend → Railway backend, cross-origin;
`apps/api/src/auth/session.ts` `sessionCookieOptions()`, no bearer fallback):

- Dev (`NODE_ENV !== 'production'`): `HttpOnly=true, Secure=false,
  SameSite=Lax` (local HTTP + Vite `/api` proxy stay first-party).
- Production: `HttpOnly=true, Secure=true, SameSite=None` (cross-site HTTPS
  with `credentials: 'include'`).
- Frontend: all authenticated fetches use `credentials: 'include'`
  (`apps/web/src/lib/api.ts` `apiFetch`; `Profile.tsx` debug fetch); Vite dev
  proxy unchanged. Explained in `apps/web/README.md`.

CORS allowlist mechanism (`@fastify/cors`, `credentials: true`, never `*`):

- `apps/api/src/app.ts` registers `@fastify/cors` with an explicit-allowlist
  callback: no `Origin` → allow (same-origin/curl); listed origin → echo it;
  unlisted → `cb(null, false)` (no `access-control-allow-origin`, fail closed).
- Allowlist source: `CORS_ORIGINS` (comma-separated) via
  `parseCorsOrigins()` in `apps/api/src/env.ts`. Dev default when unset:
  `http://localhost:5173`. Production: from env only (empty when unset).
- `.env.example` documents `CORS_ORIGINS=` (placeholder, no secret).

Tests (new `apps/api/test/auth-cookie-cors.test.ts`, 8 tests, all pass):

- Dev cookie attributes (Lax/false/HttpOnly); prod attributes (None/true/HttpOnly).
- `parseCorsOrigins`: dev default, comma-separated parsing, prod-empty fail-closed.
- Allowlisted origin succeeds (`access-control-allow-origin` echoes,
  `allow-credentials: true`, never `*`); non-allowlisted origin gets no
  `access-control-allow-origin`; preflight never emits `*`.
- Oracle still 4/4 pass (Step 1 command).

Verification (actual, via `npm.cmd`; DATABASE_URL loaded from local `.env.txt`
into the shell, value never printed):

- `run typecheck` → clean, exit 0.
- `run lint` → clean after stray-file removal, exit 0.
- `run test` (live DB) → api 66 pass + shared 1 pass (7 api files incl. 18 live
  auth, 8 cookie/CORS, 4 oracle, 28 crypto, 5 env, 2 health, 1 connectivity),
  exit 0.
- `run build` → clean (api tsc; web vite 51 modules; shared tsc), exit 0.
- Step 1 oracle command
  (`npm.cmd run test --workspace takeover-api -- test/nimiq-oracle.test.ts`) →
  1 file / 4 tests pass, exit 0.
- Citation: URL + file paths as above.

npm audit note (reported only; NO `audit fix`, NO dependency changes in this phase):
9 total — 6 moderate, 2 high, 1 critical. Packages: drizzle-orm (high: SQL
injection via identifiers GHSA-gpj5-g38j-94v9); vite (high: path traversal in
optimized-deps .map handling); vitest (critical: arbitrary file read/exec
when Vitest UI server listening); moderate: esbuild (dev-server request
forgery), vite-node (via vite), drizzle-kit (via esbuild-kit/esbuild),
@esbuild-kit/core-utils, @esbuild-kit/esm-loader, @vitest/mocker (path
traversal). Production-only (`--omit=dev`): 1 high (drizzle-orm).

Secret handling: DATABASE_URL and session secrets were NEVER printed in
outputs, logs, or commits (key names + boolean presence/length only);
`.env.txt` stays gitignored; raw session tokens only in set-cookie/test
memory, SHA-256 hashes at rest; no private keys anywhere.

Files changed (Phase 3 completion): `package.json` + `package-lock.json`
(@nimiq/core dev oracle from partial work + @fastify/cors),
`apps/api/package.json` (@fastify/cors),
`apps/api/src/types/nimiq-core.d.ts` (new: test-only ambient typing, fixed to
`Signature.deserialize`), `apps/api/test/nimiq-oracle.test.ts` (new: fixed
syntax + deserialize + verified citation comment),
`apps/api/src/{app,env}.ts`, `apps/api/src/auth/session.ts`, `.env.example`,
`apps/web/README.md` (new), `apps/api/test/auth-cookie-cors.test.ts` (new),
`ARCHITECTURE.md` (s4.5), `IMPLEMENTATION_PLAN.md` (Phase 3 clarification),
`AI_HANDOFF.md` (this checkpoint). Deleted stray `apisrctypesnimiq-core.d.ts`.

```text
CURRENT PHASE: Phase 3 completion (NOT a new phase)
COMPLETED: signature scheme proven vs @nimiq/core oracle; cookie/CORS for
  Vercel/Railway cross-origin; auth-specific tests incl. CORS
TESTS RUN: typecheck clean; lint clean; tests 66 api + 1 shared pass (18 live
  auth incl. replay/forge/expiry/revoke/rate-limit; 8 cookie/CORS; 4 oracle);
  build clean; oracle command 4/4 pass
RESULT: Phase 3 complete — only a valid wallet signature authenticates; cookies
  + CORS correct for the locked cross-origin topology
KNOWN ISSUES: npm audit 9 vulns noted above (no fix in this phase, per instruction)
SECURITY NOTES: DATABASE_URL/session secrets never printed; tokens only in
  set-cookie/memory, hashes at rest; no private keys; envelopes leak no stacks
FILES CHANGED: see list above
GIT COMMIT: chore: phase 3 completion — auth verification and cookie/CORS
NEXT TASK: Phase 4 — Marketplace read path (do NOT start automatically)
BLOCKED BY: none
```

## Phase 3 implementation results (2026-09-11)

Server-side wallet auth (Nimiq signature + opaque sessions) plus minimal frontend
signing wiring. No slots/claims/payments/admin/transaction-sending.

Backend (`apps/api/src/`):
- `auth/nimiq-address.ts` — canonicalization (spaces stripped, uppercase, 36 chars,
  NQ prefix, custom base32 alphabet, IBAN mod97==1; rejects everything else),
  Blake2b-256 via @noble/hashes, Nimiq user-friendly encode/derive.
- `auth/challenge.ts` — `TAKEOVER-AUTH:v1:<nonce>:<issuedAtISO>`, 32-byte hex nonce,
  5-min TTL, 7-day session TTL constants.
- `auth/session-token.ts` — `<sessionId>.<base64url-secret>` tokens, SHA-256 hex
  storage, strict parse, timing-safe compare.
- `auth/nimiq-verify.ts` — production verifier (see method below) + injectable
  `VerifySignatureFn` (tests only).
- `http/errors.ts` + `http/rate-limit.ts` — `{data,requestId}` / `{error,requestId}`
  envelopes; in-memory per-IP fixed-window limiter.
- `auth/session.ts` — `takeover_session` cookie (HttpOnly; Secure in prod only;
  SameSite=Lax), session middleware (never throws; disabled users treated as
  unauthenticated), requireAuth (401 UNAUTHENTICATED), server-side logout revoke.
- `routes/auth.ts` — POST challenge/verify/logout + GET /me (with
  hasProviderProfile), Zod strict bodies, 16KB body limits, wallet-bound +
  single-use (race-safe consume) + 5-min expiry (401 AUTH_EXPIRED) + disabled
  rejection (403 USER_DISABLED).
- `app.ts` — request-id (UUID) + x-request-id header, /health unchanged (plain,
  DB-free), /api/v1 prefix, enveloped 404/400/413/415/500 handler (no stacks leak).

Frontend (`apps/web/src/`): @nimiq/mini-app-sdk 0.1.0 (connect/listAccounts/sign
only — no transactions), zustand auth store (login/challenge-sign-verify, logout,
refresh-on-boot), TopBar + WalletStatus (Connect Wallet / truncated address +
logout), /profile debug route showing raw /me, Vite /api proxy to :3001.

SIGNATURE VERIFICATION METHOD (production, NOT mocked):
`verifyNimiqSignature` in `apps/api/src/auth/nimiq-verify.ts`. The installed SDK
exposes NO server-side verify primitive (client-only: init/listAccounts/sign/
send*), so per the locked decision the fallback applies — but as pure local
cryptography, not RPC: (1) decode publicKey (strict hex-or-base64, 32 bytes);
(2) derive the Nimiq address (Blake2b-256 → 20 bytes → IBAN) and require it to
equal the claimed canonical address (binds key to identity — a wallet signing
with any other account fails closed); (3) hash the official Hub envelope
`sha256('\x16Nimiq Signed Message:\n' + len + message)` and Ed25519-verify with
tweetnacl. No network, no RPC, no secrets, deterministic. WHY: SDK has no verify
helper; RPC is unnecessary for signature math and would add a trusted third party
to authentication. Grounded by: official nimiq-keys address.rs semantics
(alphabet/blake2b/IBAN), the NQ07-zero-address vector, BLAKE2b-256 cross-checked
noble == OpenSSL (hashlib), and sign→verify round-trips. RESIDUAL RISK: whether
the native mini-app `sign()` applies exactly the Hub envelope and which string
encoding it returns for signature/publicKey (accepted: strict hex or base64) can
only be proven against a real wallet — deferred to Phase 14 Nimiq Pay deployment
verification. The envelope is isolated in `nimiqSignedMessageHash` for adjustment.
Tests inject a stub ONLY via `buildApp({ verifySignature })`; the default wiring
always uses the real verifier (assert: no test constructs production traffic with
the stub; crypto.test.ts uses real tweetnacl signatures).

SAMESITE COOKIE BEHAVIOR: dev only (localhost HTTP, Secure=false, Lax) — login
cookies verified working via inject tests (set-cookie → cookie → /me 200). The
cross-origin production path (Vercel → Railway) is untested; if the Mini App
WebView drops Lax cookies there, SameSite=None; Secure will be required (recorded
here per instruction). No bearer fallback added — cookies have not demonstrably
failed.

RATE LIMITS: 10 req / 60s / IP on each of challenge and verify (in-memory Map,
opportunistic pruning; multi-instance would need shared storage — later phase).
Proven: 4th challenge request with max:3 → 429 RATE_LIMITED envelope.

IMPLEMENTATION DETAILS — AGENT DECIDED:
- New deps: @fastify/cookie, tweetnacl, @noble/hashes (api); @nimiq/mini-app-sdk,
  zustand, react-router-dom (web). Nothing in-tree solved these.
- Failed verifies do NOT burn the challenge (rate limiter bounds retries); consume
  happens once, on success, race-safe via conditional UPDATE+returning.
- Expired challenge → 401 AUTH_EXPIRED; missing/consumed/mismatched/bad-signature
  → 401 UNAUTHENTICATED; disabled at verify → 403 USER_DISABLED; disabled
  mid-session → treated as unauthenticated (401), since disabled status is
  admin-only data per ARCH s11.
- 413/415/400 parse errors → INVALID_INPUT envelope (status preserved).
- session middleware refreshes last_seen_at (activity signal, not sliding expiry —
  lifetime stays 7 days from creation per locked decision).
- trustProxy:true (req.ip behind Railway); created_at written explicitly on
  challenge insert so the signed string byte-matches the stored row.
- tsconfig.base stays CommonJS/Node (a NodeNext attempt caused drizzle
  dual-package type splits — reverted; noble typed via a minimal ambient
  declaration, runtime via exports map, proven by tests + live build).
- API build emits repo-rooted dist (dist/apps/api/src/server.js) because the api
  imports shared db/ modules; start script updated accordingly.
- Minor doc delta (reported, not decided): ARCH s13 shows verify body with
  `challengeId`; implementation uses `{walletAddress, nonce, signature, publicKey?}`
  per the locked Phase 3 decision (same single-use/wallet-bound semantics).

Verification (actual, via `npm.cmd`; node v24.20.0 / npm 11.19.0):
- `run typecheck` → clean (all workspaces + db), exit 0.
- `run lint` → clean, exit 0. `run format` → clean, exit 0.
- `run test` (live DB) → 55/55 pass: env 5, crypto 28, health 2, db-connectivity 1,
  auth-live 18, shared 1. Exit 0.
- `run build` → clean (api tsc incl. db emit; web vite 51 modules incl. SDK;
  shared tsc), exit 0. `run db:verify` → SELECT 1 ok, 9 tables.
- Live built server (PORT=3102): GET /health → 200 `{"status":"ok"}`;
  POST /auth/challenge (zero-address) → 200 `{data:{challenge,expiresAt,nonce},
  requestId}`; GET /me without cookie → 401
  `{"error":{"code":"UNAUTHENTICATED","message":"Authentication required."},
  "requestId":"..."}`. Port free, no residue.

## Checkpoint

```text
CURRENT PHASE: Phase 3 complete
COMPLETED: wallet auth + opaque sessions + minimal SDK signing UI
TESTS RUN: typecheck/lint/format clean; tests 55/55 pass (28 crypto incl. real
  vectors + round-trips, 18 live auth incl. replay/forge/expiry/revoke/rate-limit);
  build clean; db:verify ok; live curls: challenge envelope 200, /me 401 envelope
RESULT: only a valid wallet signature authenticates; no client address
  impersonation (pubkey→address binding enforced server-side)
KNOWN ISSUES: real-wallet envelope/encoding proof deferred to Phase 14;
  production cross-origin cookie behavior untested (SameSite=None fallback noted)
SECURITY NOTES: DATABASE_URL and session secrets never printed (key names +
  boolean presence only); raw tokens only in set-cookie/tests memory, SHA-256
  hashes at rest; .env.txt gitignored; no private keys anywhere; error envelopes
  leak no stacks/DB internals
FILES CHANGED: apps/api/src/{auth/{nimiq-address,challenge,session-token,
  nimiq-verify,session},http/{errors,rate-limit},routes/auth,app}.ts,
  apps/api/src/types/noble-hashes-blake2.d.ts, apps/api/{package.json,
  tsconfig.build.json}, apps/api/test/{crypto,auth}.test.ts,
  apps/web/{package.json,vite.config.ts},
  apps/web/src/{lib/{api,nimiq},store/auth,components/{TopBar,WalletStatus},
  routes/{Home,Profile},App}.tsx/ts, package-lock.json, README.md,
  AI_HANDOFF.md (this checkpoint)
GIT COMMIT: feat: phase 3 wallet authentication and sessions
NEXT TASK: Phase 4 — Marketplace read path (do NOT start automatically)
BLOCKED BY: none
```

## Exact next task (Phase 4 — awaiting explicit instruction, DO NOT start)

Phase 4 objective per `IMPLEMENTATION_PLAN.md`: make active supply discoverable
(slot public read service, filtering/sorting/pagination, slot detail endpoint,
public/private serializer; marketplace home, filters, slot cards, detail shell).
STOP — do not begin Phase 4 automatically.

## Phase 2 follow-up results (2026-09-11)

Applied the five accepted resolutions in migration `db/migrations/0001_zippy_shiver_man.sql`
(+ journal/snapshot), reviewed the SQL before applying, applied it to live Supabase, and
confirmed via `information_schema` + `pg_get_indexdef`: 9 tables, 7/7 new columns present,
partial index predicate `status IN (active_hold, payment_pending, payment_review)` with
`paid` absent. No application logic, no seed data, no API route changes.

- Schema adds: `users.disabled_at`, `slots.cancelled_at`/`expired_at`,
  `claims.quantity` (INTEGER NOT NULL DEFAULT 1 + `claims_quantity_check`),
  `reports.resolved_by_user_id` (FK users.id) + `resolution_notes`,
  `audit_events.request_id`; claims partial index dropped and recreated without `paid`.
- `db/verify.ts` extended (read-only): reports follow-up column coverage (7/7) and prints
  + asserts the partial-index predicate on every run.
- `ARCHITECTURE.md` §9 rewritten to the implemented schema (enums, token_hash,
  provider_profiles own-PK, slots/claims/payment_intents/reports/audit_events columns,
  corrected partial-index rule, slots indexes/constraints). No other ARCH sections needed
  changes (§7/§8/§11/§13/§16 language is generic and consistent).
- SPEC conflict check: none. FR-05 "active claim" language aligns with the corrected
  predicate (paid claims are not active); `quantity` aligns with the claim `{quantity: 1}`
  contract; lifecycle/audit adds align with FR-09/FR-11.
- Secret handling: `DATABASE_URL` value never printed in outputs, logs, or commits
  (key name + boolean presence only); `.env.txt` stays gitignored; migration files
  contain no secrets.

Verification (actual, via `npm.cmd`; node v24.20.0 / npm 11.19.0):

- `run typecheck` → clean, exit 0. `run lint` → clean, exit 0.
- `run db:migrate` → `migrations applied successfully!`, exit 0.
- `run db:verify` → `SELECT 1 ok`; `tables (9)`; `follow-up columns ok (7/7)`;
  `partial index: ... WHERE (status = ANY (ARRAY['active_hold'::claim_status,
  'payment_pending'::claim_status, 'payment_review'::claim_status]))`, exit 0.
- `run test` (live DB env) → 9/9 pass, exit 0. `run build` → clean, exit 0.
  `run format` → clean (after prettier --write on db/verify.ts), exit 0.

## Checkpoint

```text
CURRENT PHASE: Phase 2 follow-up complete
COMPLETED: 5 schema resolutions migrated + live-verified; ARCHITECTURE.md s9 reconciled
TESTS RUN: typecheck clean; lint clean; tests 9/9 pass (incl. live SELECT 1);
  build clean; format clean; columns 7/7 + corrected index predicate verified live
RESULT: schema is source of truth; docs match implementation; paid claims no longer
  block re-hold on multi-quantity slots
KNOWN ISSUES: none
SECURITY NOTES: DATABASE_URL never printed; .env.txt gitignored; no secrets in commits
FILES CHANGED: db/schema/{users,slots,claims,reports,audit-events}.ts, db/verify.ts,
  db/migrations/0001_*.sql + meta/*, ARCHITECTURE.md (s9), AI_HANDOFF.md (this checkpoint)
GIT COMMIT: chore: phase 2 follow-up — schema and docs reconciliation
NEXT TASK: Phase 3 — Wallet authentication (do NOT start automatically)
BLOCKED BY: none
```

## Exact next task (Phase 3 — awaiting explicit instruction, DO NOT start)

Phase 3 objective per `IMPLEMENTATION_PLAN.md`: secure wallet-based identity and
sessions (challenge creation, Nimiq signature verification, session creation, logout,
current-user endpoint, auth middleware, disabled-user enforcement). STOP — do not
begin Phase 3 automatically.

## Phase 2 implementation results (2026-09-11)

Implemented the 9-table MVP relational model exactly per the Phase 2 brief, generated
migration `db/migrations/0000_futuristic_the_hunter.sql` (+ journal/snapshot), applied it
to the live Supabase database (was confirmed empty: 0 tables), and confirmed 9 tables
via `information_schema`. No application logic, no seed data, no API route changes
(`/health` untouched and still DB-independent).

- Schema: `db/schema/` — `enums.ts` (6 pgEnums) + one module per table
  (`users`, `auth`, `provider-profiles`, `slots`, `claims`, `payment-intents`,
  `reports`, `audit-events`) + barrel `index.ts`. All brief-required UNIQUEs,
  the 3 slots CHECKs, the partial unique claims index, and the 4 listed indexes
  verified present in the generated SQL before applying.
- Scripts: `db:generate`, `db:migrate` (drizzle-kit with `--config=db/drizzle.config.ts`),
  `db:verify` (`tsx db/verify.ts` — `SELECT 1` + `information_schema` table list).
- Connectivity: `apps/api/test/db-connectivity.test.ts` runs live `SELECT 1` via
  `getDb()` when `DATABASE_URL` is set, else `skipIf` so `npm run test` stays green offline.
- Secret handling: env source is local `.env.txt` (contains only `DATABASE_URL`);
  values were loaded into the shell and NEVER printed — outputs/logs/commits contain
  only key names and boolean presence. `.env.txt` added to `.gitignore` (it was
  previously unignored — secret-leak risk closed). No `.env` file created. Migration
  SQL, journal, and snapshot contain no secrets.
- REPORTED (not decided) — Phase 2 brief vs `ARCHITECTURE.md` s9 naming/content deltas.
  Implemented the brief exactly; `ARCHITECTURE.md` s9 was NOT edited (needs owner call):
  users `role` enum(buyer/provider/admin, dflt buyer) vs TEXT DEFAULT USER + `disabled_at`
  (brief: `status` enum, no `display_name`); sessions `token_hash` vs `session_hash`;
  provider_profiles own-`id` PK + `display_name`/`verified` bool vs `user_id` PK/FK +
  `provider_name`/geo/`verified_at`; slots `starts_at`/`ends_at` (nullable),
  `total_quantity`, `price_nim`, `payout_wallet`, nullable description/category/location
  vs `start_at`/`end_at NOT NULL`, `capacity`, `price_nim_base_units`,
  `payout_wallet_address`, `venue_* NOT NULL`, `cancelled_at`/`expired_at`;
  claims `claimed_at`, NO `quantity` column (multi-unit claims would then always be 1 —
  flag for Phase 6), no `payment_pending_until`/`paid_at`/`cancelled_at`;
  payment_intents `expected_*` naming + single nullable-unique `tx_hash` + `submitted_at`
  vs `submitted/verified_tx_hash` split + `verification_attempts`/`last_verification_error`;
  reports `reason`/`details`/`reviewed_at` vs `category`/`description`/`resolved_by`/`resolved_at`;
  audit_events `metadata` jsonb + `entity_id` TEXT NOT NULL vs `metadata_json` +
  `entity_id` UUID NULL + `request_id`. Note: claims partial index includes `paid` and
  `payment_review` — stricter than ARCH s9 ("one ACTIVE_HOLD or PAYMENT_PENDING per
  buyer+slot"); a buyer with a paid claim cannot hold the same slot again (matters for
  multi-quantity slots in Phase 6). None of the deltas break the AGENTS.md business-rule
  invariants at schema level (replay guards, tx uniqueness, inventory CHECKs present).

IMPLEMENTATION DETAILS — AGENT DECIDED:

- `created_at`/`updated_at`/`claimed_at`/`last_seen_at` (all NOT NULL per brief) get
  `DEFAULT now()`; `updated_at` has no DB trigger — app sets it explicitly (later phases).
- FKs use drizzle defaults (`ON DELETE/UPDATE no action`); no cascades invented.
- Drizzle table/column naming: camelCase JS keys with explicit snake_case DB names.
- `db/migrations/.gitkeep` removed (real migration files now stage the directory).

Verification (actual, via `npm.cmd`; node v24.20.0 / npm 11.19.0):

- `run typecheck` → clean (api+web+shared+db), exit 0 (re-run after prettier fix).
- `run lint` → clean, exit 0 (re-run after prettier fix).
- `run db:verify -- --expect-empty` (pre-migration) → `SELECT 1 ok`, `tables (0): (none)`, exit 0.
- `run db:generate` → 9 tables detected, `0000_futuristic_the_hunter.sql` created, exit 0.
- `run db:migrate` → `migrations applied successfully!`, exit 0.
- `run db:verify` (post-migration) → `SELECT 1 ok`, `tables (9): audit_events,
  auth_challenges, claims, payment_intents, provider_profiles, reports, sessions,
  slots, users`, exit 0.
- `run test` (with live DB env) → 9/9 pass (api 5 env + 2 health + 1 live
  connectivity; shared 1 smoke), exit 0.
- `run build` → clean all 3 workspaces, exit 0. `run format` → clean, exit 0.

## Checkpoint

```text
CURRENT PHASE: Phase 2 complete
COMPLETED: 9-table schema + migration applied to live Supabase (was empty, now 9 tables)
TESTS RUN: typecheck clean; lint clean; tests 9/9 pass (incl. live SELECT 1);
  build clean; format clean; pre/post-migration information_schema verified (0 -> 9)
RESULT: clean database migrates from zero; constraints/indexes/FKs live;
  no domain logic yet; /health still DB-independent
KNOWN ISSUES: none functional. Brief-vs-ARCHITECTURE-s9 deltas reported above —
  ARCHITECTURE.md s9 needs owner reconciliation before/at Phase 3.
SECURITY NOTES: DATABASE_URL never printed (key name + boolean presence only);
  .env.txt gitignored; migration files contain no secrets; no seed data; no API
  routes touch the DB
FILES CHANGED: .gitignore, package.json, db/schema/* (9 new + index.ts),
  db/tsconfig.json, db/verify.ts, db/migrations/0000_*.sql + meta/*,
  apps/api/test/db-connectivity.test.ts, AI_HANDOFF.md (this checkpoint)
GIT COMMIT: chore: phase 2 database schema and migrations
NEXT TASK: Phase 3 — Wallet authentication (do NOT start automatically)
BLOCKED BY: none
```

## Exact next task (Phase 3 — awaiting explicit instruction, DO NOT start)

Phase 3 objective per `IMPLEMENTATION_PLAN.md`: secure wallet-based identity and
sessions (challenge creation, Nimiq signature verification, session creation, logout,
current-user endpoint, auth middleware, disabled-user enforcement). STOP — do not
begin Phase 3 automatically.

## Phase 1 implementation results (2026-09-11)

Created the npm-workspaces monorepo foundation. No product features, no auth,
no slots/claims/payments/admin, no Nimiq SDK wiring (all deferred per phase scope).

New structure:

```text
package.json (workspaces: apps/*, packages/*; engines node>=20; type: module)
.nvmrc (24.20.0) | .gitignore | .env.example | LICENSE (MIT) | README.md
tsconfig.base.json | eslint.config.js (flat) | .prettierrc / .prettierignore
apps/web    # Vite 5 + React 18 + TS + Tailwind v3 placeholder page
apps/api    # Fastify 5 + Zod; GET /health -> { "status": "ok" }; env validation
packages/shared  # placeholder contracts only (version/health/app-info)
db/         # drizzle.config.ts + schema/index.ts (empty) + lazy client.ts
tests/ docs/checkpoints/  # staged with .gitkeep
package-lock.json (committed)
```

- `GET /health` has no DB dependency; API boots with zero env configured.
- Env policy (Phase 1): all vars optional; `loadEnv()` warns and falls back,
  never throws; pure `parseEnv()` throws ZodError for tests/later phases.
- Secrets: only `.env.example` (placeholders) committed; `.env` gitignored;
  no secrets in browser bundle (web has no env wiring at all).
- `/health` returns `{ "status": "ok" }` (plain infra shape). The
  `{data,requestId}` envelope from ARCHITECTURE.md s12 applies to `/api/v1`
  routes starting Phase 3 — no conflict.

IMPLEMENTATION DETAILS — AGENT DECIDED (within fixed architecture):

- Dependency majors: react 18.3.1, vite ^5.4, tailwind ^3.4 (+postcss/autoprefixer),
  fastify ^5.0, zod ^3.23, drizzle-orm ^0.36 / drizzle-kit ^0.28, pg ^8.13,
  vitest ^2.1, eslint ^9.14 + typescript-eslint ^8, prettier ^3.3, tsx ^4, TS ^5.6.
  (Registry resolved eslint 9.39.5 with a "no longer supported" deprecation
  notice — functional; revisit in a later phase if needed.)
- API default port 3001 (web dev keeps Vite default 5173).
- Root `type: module` added solely to silence Node's typeless-package warning
  when ESLint loads the flat config; api/shared stay CommonJS via tsc.
- `db/` is not a workspace (no package.json); runtime DB deps (`drizzle-orm`,
  `pg`) live in `takeover-api`; `db/` has its own tsconfig checked by root `typecheck`.
- Root `dev` starts the API; `dev:web` / `dev:api` documented in README.
- Prettier ignores the authoritative spec markdown docs (never reformat them).
- LICENSE copyright: `onyebuchidaniel60` (repo owner handle).
- No dotenv dependency: devs copy `.env.example` to `.env`; Node `--env-file`
  or shell exports supply values.

Verification (actual, via `npm.cmd`; toolchain node v24.20.0 / npm 11.19.0):

- `npm.cmd install --no-audit --no-fund` → 466 packages, exit 0.
- `npm.cmd run typecheck` → clean (api + web + shared + db), exit 0.
- `npm.cmd run lint` → clean, exit 0.
- `npm.cmd run test` → 8/8 pass (api: 5 env + 2 health; shared: 1 smoke), exit 0.
- `npm.cmd run build` → api (tsc) + web (vite: 31 modules, dist ok) + shared (tsc), exit 0.
- `npm.cmd run format` → clean after scoping spec docs out, exit 0.
- Live: built `apps/api/dist/server.js` on PORT=3101 → `GET /health` = 200
  `{"status":"ok"}` (verified via Invoke-RestMethod; Fastify log confirms).
  No DB configured; port free and no node residue afterwards.
- Note: PowerShell 5.1 `$?` after `npm.cmd ... 2>&1` can report False despite
  exit 0 (stderr-merge artifact); use `$LASTEXITCODE` as authoritative.

## Checkpoint

```text
CURRENT PHASE: Phase 1 complete
COMPLETED: monorepo foundation + env (no product features)
TESTS RUN: typecheck clean; lint clean; tests 8/8 pass; build clean (all 3
  workspaces); format clean; live /health 200 {"status":"ok"} without DB
RESULT: frontend builds, backend starts, health returns 200, no DB required
KNOWN ISSUES: eslint 9.39.5 deprecation notice (functional); $PROFILE-scope
  note: use npm.cmd + $LASTEXITCODE on this Windows env
SECURITY NOTES: no secrets committed (.env.example placeholders only);
  no auth/payment surface exists yet; .env gitignored
FILES CHANGED: package.json, package-lock.json, .nvmrc, .gitignore,
  .env.example, LICENSE, README.md, tsconfig.base.json, eslint.config.js,
  .prettierrc, .prettierignore, apps/web/**, apps/api/**,
  packages/shared/**, db/**, tests/.gitkeep, docs/checkpoints/.gitkeep,
  AI_HANDOFF.md (this checkpoint)
GIT COMMIT: chore: phase 1 foundation and environment
NEXT TASK: Phase 2 — Database schema and migrations (do NOT start automatically)
BLOCKED BY: none (Phase 2 will need Supabase DATABASE_URL for migration smoke test)
```

## Exact next task (Phase 2 — awaiting explicit instruction, DO NOT start)

Phase 2 objective per `IMPLEMENTATION_PLAN.md`: create the complete MVP
relational model (users, sessions, auth_challenges, provider_profiles, slots,
claims, payment_intents, reports, audit_events) with constraints/indexes and
migration scripts. STOP — do not begin Phase 2 automatically.

## Phase 0 reconnaissance results (2026-09-11)

Baseline: the repository contains NO application code. Tracked in git: only
`README.md` (2 lines). Present in working tree but untracked before this
checkpoint: `AGENTS.md`, `AI_HANDOFF.md`, `ARCHITECTURE.md`,
`IMPLEMENTATION_PLAN.md`, `PROJECT_SPEC.md`, `TAKEOVER_COMPLETE_BLUEPRINT.md`.

- Architecture (actual): none implemented. No frontend, backend, database,
  auth, payment, tests, lint/build scripts, env config, or deployment config.
- Stack (actual): no `package.json`, no lockfile, no dependencies at all —
  specified stack (React+Vite+Tailwind+SDK / Fastify+Zod / Postgres+Drizzle)
  is 0% implemented. Greenfield.
- Entry points: none. No `src/`, `apps/`, `index.html`, server entry.
- Reusable components: none exist.
- Nimiq integration: none. No `@nimiq/mini-app-sdk`, no wallet/auth/payment code.
- Backend/database: none. No Fastify app, no Drizzle schema, no migrations.
- Auth/payment: none. No sessions, challenges, claims, intents, verification.
- Spec comparison: every MUST HAVE in `PROJECT_SPEC.md` (FR-01–FR-11) and every
  system in `ARCHITECTURE.md` is unimplemented. No conflicts with the spec —
  there is no code to conflict. Spec docs are mutually consistent.
- Security risks in existing code: none (no code). Process risks noted:
  spec docs were untracked in git; no `LICENSE` (competition requires MIT —
  Phase 15 item); no secrets present (good); remote is public GitHub
  `onyebuchidaniel60/TAKEOVER`.
- Verification run: `npm run build` / `lint` / `test` all fail with ENOENT
  (no `package.json`) — N/A by design at baseline. Typecheck N/A (no
  `tsconfig`). Toolchain: node `v24.20.0`, npm `11.19.0` (via `npm.cmd`;
  `npm.ps1` blocked by ExecutionPolicy). `git log`: single commit `82764dc`
  "Initial commit" (README only).
- Phase 1 will CREATE (no existing files to modify): `package.json` +
  lockfile, `apps/web` (React+Vite+TS+Tailwind+SDK scaffold), `apps/api`
  (Fastify+TS+Zod), env validation module, DB client/config, `GET /health`,
  dev scripts, `.gitignore`, `tsconfig` base.
- Blockers: none hard. Phase 1 needs: package-manager choice, monorepo layout
  confirmation (`apps/web`, `apps/api` per plan), Supabase project/connection
  string for DB smoke test, Node version pin.

## Checkpoint

```text
CURRENT PHASE: Phase 0 complete
COMPLETED: repository audit
TESTS RUN: npm run build / lint / test — all N/A (ENOENT, no package.json);
  typecheck N/A (no tsconfig); git/file-system inspection done
RESULT: baseline confirmed — greenfield repo, spec docs consistent, no code
KNOWN ISSUES: spec docs were untracked; no LICENSE yet (Phase 15);
  npm.ps1 blocked by Windows ExecutionPolicy (use npm.cmd)
SECURITY NOTES: no application code, no secrets, nothing to exploit;
  no auth/payment surface exists yet
FILES CHANGED: AI_HANDOFF.md (this checkpoint); newly tracked baseline docs:
  AGENTS.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, PROJECT_SPEC.md,
  TAKEOVER_COMPLETE_BLUEPRINT.md
GIT COMMIT: chore: baseline repository audit
NEXT TASK: Phase 1 — Foundation and environment (do NOT start automatically)
BLOCKED BY: none (needs: package-manager + layout confirmation, Supabase DB URL)
```

## Exact next task (Phase 1 — awaiting explicit instruction, DO NOT start)

Phase 1 objective per `IMPLEMENTATION_PLAN.md`: make the fixed
frontend/backend/database architecture boot cleanly (workspaces, env
validation, Zod, Drizzle connection, `GET /health`, dev scripts, preserve Nimiq
SDK integration). STOP — do not begin Phase 1 automatically.

## Known deliberate limitations

The MVP has no escrow or automated refunds. This is a conscious scope/security decision, not an unfinished feature.

The MVP does not automatically prove that an external business booking exists. The marketplace assumes the publisher is authorized to provide the listed capacity and provides reporting/moderation controls for abuse.

## Implementation detail allowance

The agent may choose low-level implementation details only when they do not change externally visible product behavior or architecture. Such decisions must be documented when material.

## Phase 14c diagnosis — Nimiq Pay session cookie loss (Risk A root-caused, 2026-09-14)

DIAGNOSE ONLY. No code changed (no auth/session/CSRF/deployment edits). Full
diagnosis: `docs/phase-14c-diagnosis.md`. Owner approval required before any
fix implementation (Bearer contract change + CSRF Bearer exemption).

```text
CURRENT PHASE: Phase 14c complete (diagnosis) — STOP for owner review; do NOT
  implement the fix, do NOT re-run 14a/14b, do NOT begin Phase 15
COMPLETED: all 6 drop-cause investigations + live Set-Cookie capture (throwaway
  wallet, residue removed) + 3-option comparison with recommendation +
  docs/phase-14c-diagnosis.md + this checkpoint
TESTS RUN: typecheck clean exit 0; lint clean exit 0; full suite green —
  api 311 pass (27 files) + web 96 pass (11 files) + shared 1 pass, exit 0;
  live GET /health → 200 {"status":"ok"}; live POST /auth/challenge → 200;
  live POST /auth/verify → 200 + exactly one Set-Cookie (attributes in §1
  below); residue removed (users/sessions/audits/challenges 1 each, counts only)
RESULT: Risk A root-caused — cross-site third-party session cookie dropped by
  the Nimiq Pay Android WebView's third-party-cookie policy (per-WebView app
  setting, defaults to deny on modern targets, undocumented by Nimiq Pay).
  SameSite=None; Secure is necessary but not sufficient there. Recommended fix:
  Option 2 Bearer-token fallback (same session token, alternate presentation;
  cookie path retained; CSRF guard unchanged on cookie path, explicit exemption
  for Bearer-only requests pending approval) + Partitioned as a one-line
  companion. Option 3 (same-origin proxy) flagged as needing architecture approval.
KNOWN ISSUES: Risks B/C/D still UNTESTED (blocked behind auth); SET-vs-SEND half
  of the drop needs the chrome://inspect device check (fix-identical, non-blocking);
  Nimiq Pay cookie policy / WebView version / Origin header undocumented;
  minor doc drift: ARCH §4.2 "sliding renewal" vs fixed 7-day expiresAt in code
SECURITY NOTES: no guard weakened (csrf.ts untouched); no secrets printed or
  committed (token redacted in the doc; DATABASE_URL via shell var only);
  Bearer trade-off stated (loses HttpOnly, XSS-bar context given, needs explicit
  acceptance); no new dependency proposed; payment/claim logic untouched;
  VERCEL/RAILWAY tokens stay in .env.txt (Phase 15 task)
FILES CHANGED: docs/phase-14c-diagnosis.md (new), AI_HANDOFF.md (this checkpoint)
GIT COMMIT: docs: phase 14c — diagnose nimiq pay session cookie loss
NEXT TASK: owner approves/rejects (a) verify-body token contract change and
  (b) CSRF Bearer exemption → follow-up completion pass implements per
  docs/phase-14c-diagnosis.md §6 → human re-tests 14b on-device (then B/C/D)
BLOCKED BY: owner approval (auth-contract change); optionally the 5-min
  chrome://inspect device check in diagnosis §5
```

1. What was confirmed about the cookie drop (with citations):
   - Prod emits exactly `takeover_session=<token>; Path=/; HttpOnly; Secure;
     SameSite=None` — no Domain, no Max-Age/Expires (host-only SESSION cookie).
     Code: `apps/api/src/auth/session.ts:28-44` (options), `:192` (set on
     verify). Live: throwaway `/auth/verify` → 200 with that header verbatim
     (token redacted).
   - Cross-site/third-party by topology: Vercel page origin vs Railway API
     origin share no private suffix. Android WebView defaults to disallowing
     third-party cookies (targetSdk 21+, per-WebView app policy):
     `developer.android.com/.../webkit/CookieManager`; Chromium WebView
     delegates cookie permissions to the app
     (`chromium.../android_webview/docs/cookies.md`). Nimiq Pay documents no
     cookie policy (full `nimiq.dev/mini-apps/faq` checked — only "call any
     external API using fetch()", which is our pattern).
   - Top-level-document note VERIFIED (no iframe; `nimiq.dev/mini-apps` "How It
     Works" + SDK `init()` polling `window.nimiq`), with the clarification that
     top-level does NOT make the API cookie first-party.
   - The 401 (not 403) proves the cookie was absent: "authentication required"
     is thrown only by `requireAuth` (`session.ts:105`); the CSRF guard
     (`http/csrf.ts:29-45`) skips cookieless requests and 403s only when a
     cookie is present. In-memory address (verify body, `store/auth.ts:55-59`)
     vs cookie-dependent `/me`/claim explains observations 2 vs 3/4.
   - `Partitioned` is available in installed `@fastify/cookie@11.1.2` types,
     additive-safe, but unproven without a device (CHIPS needs WebView 114+;
     partition binds to one frontend URL — alias discipline required).
2. What could not be confirmed without a device: Nimiq Pay's CookieManager
   policy, WebView version, partitioned-cookie delivery, SET-vs-SEND half
   (fix-identical), actual `Origin` header, Risks B/C/D, `sessionStorage`
   availability in the WebView.
3. Three options compared (detail in diagnosis §3): Option 1 cookie-config
   (only `Partitioned` plausible; `SameSite`/`Domain`/`Max-Age` ruled out with
   reasons) — safe but not guaranteed; Option 2 Bearer fallback —
   RECOMMENDED (same token/row/TTL/revocation; `sessionStorage`; cookie path
   retained + guard unchanged; Bearer-only CSRF exemption justified by
   no-auto-attach + preflight-gated `Authorization`, pending approval; logout
   revokes both; theft bounded by 256-bit secret + 7-day TTL; HttpOnly loss
   stated); Option 3 same-origin proxy — effective but flagged as
   architecture-approval territory (ARCH §22 data path, IP/rate-limit,
   proxy limits), not recommended.
4. Exact human step(s) still needed: (a) approve/reject the two auth-contract
   items; (b) optional 5-min `chrome://inspect` cookie/Network check
   (storage present/absent, `set-cookie` seen, `cookie` sent, WebView version,
   `Origin` value); (c) post-fix 14b re-test on-device, then B/C/D.
5. Proposed implementation plan for the chosen fix (files, tests): diagnosis
   §6 — `routes/auth.ts` (token in verify body), `auth/session.ts` (cookie-or-
   Bearer resolution + `Partitioned` line), `http/csrf.ts` (approved exemption
   only), `web/lib/api.ts` + `web/store/auth.ts` (sessionStorage wire + clear),
   ARCH §4.2/§15/§16 docs (+ sliding-renewal drift fix); tests: Bearer `/me`,
   Bearer claim→pay round-trip, 401 matrix (bad/revoked/disabled), CSRF matrix
   both paths, logout revocation, `Partitioned` prod-only unit test, full suite.
6. Files changed in this diagnostic session: `docs/phase-14c-diagnosis.md`
   (new), `AI_HANDOFF.md` (this checkpoint). Temp probe script created, run,
   and deleted (`Test-Path` → False). No auth/session/CSRF/deployment code touched.
7. Commands actually run and their actual output: `npm.cmd run typecheck` →
   clean exit 0; `npm.cmd run lint` → clean exit 0; `npm.cmd run test` (live
   DB) → api 27 files/311 pass + web 11 files/96 pass + shared 1 pass, exit 0;
   live `GET /health` → 200 `{"status":"ok"}`; live challenge → 200, verify →
   200 + 1 redacted `Set-Cookie`; cleanup counts 1/1/1/1; `git status` clean
   except the two doc files (verified before commit).

## Phase 14c completion — IMPLEMENTED, tested, pushed; DEPLOY BLOCKED on Railway (2026-09-14)

Owner approved Option 2 (Bearer fallback; no Partitioned, no proxy). Implemented
exactly per `docs/phase-14c-diagnosis.md` §6 as narrowed by the approval. No payment /
claim / RPC / admin / slots / reports / CORS-allowlist changes. Phase 15 NOT started.
Phase 14b re-test NOT run (human, real device).

```text
CURRENT PHASE: Phase 14c completion — code done + green + pushed; Railway
  redeploy NOT observed → human triggers from dashboard → then Vercel deploy
  + post-deploy verifications (all scripted below) → human 14b re-test
COMPLETED: server Bearer fallback (verify-body sessionToken; cookie-or-Bearer
  resolution, cookie preferred; approved Bearer-only CSRF exemption stated in
  csrf.ts comments, guard logic byte-identical on the cookie path) + frontend
  sessionStorage wiring (save on login, attach header, clear on logout,
  in-memory fallback) + 13 api + 7 web tests + ARCH §4.2/§16 + SECURITY_REVIEW
  threat row + inventory + this checkpoint; commit c1b5add pushed to origin/main
TESTS RUN: typecheck clean exit 0; lint clean exit 0; full suite green —
  api 28 files/324 pass (was 27/311, +13, none lowered/skipped) + web 12
  files/103 pass (was 11/96, +7) + shared 1 pass, exit 0; tag-residue check 0
RESULT: BLOCKED on deploy — 3 live probes over ~14 min after push all show the
  OLD backend (verify body has NO sessionToken; Set-Cookie unchanged, as it
  should be). Per the brief STOP rule: no Railway CLI, no improvisation, no
  Vercel deploy yet (ordered after Railway). Human triggers the redeploy.
KNOWN ISSUES: live fix not yet reachable (backend old, frontend old); Risks
  B/C/D still UNTESTED; ARCH §4.2 sliding-renewal drift fixed doc-side (7-day
  fixed expiry now stated to match code — no behavior change)
SECURITY NOTES: cookie path + guard behavior unchanged (proven by precedence +
  intact tests); exemption applies ONLY with no session cookie; token never
  logged/returned elsewhere/stored outside sessionStorage (scans enforce);
  forged/expired/revoked/disabled Bearer all 401; no secrets printed or
  committed (tokens redacted; DATABASE_URL via shell var only); probe residues
  removed every cycle (1/1/1/1 x3); temp scripts deleted; tokens stay in
  .env.txt (Phase 15 task)
FILES CHANGED: apps/api/src/auth/{session-token,session}.ts,
  apps/api/src/http/csrf.ts (comments only), apps/api/src/routes/auth.ts,
  apps/web/src/lib/api.ts, apps/web/src/store/auth.ts,
  apps/api/test/bearer-auth.test.ts (new, 13), apps/web/test/bearer-auth.test.ts
  (new, 7), ARCHITECTURE.md (§4.2 Bearer note + cookie/TTL accuracy, §16
  exemption), SECURITY_REVIEW.md (threat row + inventory 55–68),
  AI_HANDOFF.md (this checkpoint)
GIT COMMIT: c1b5add feat: phase 14c — bearer token fallback for cookie-blocking
  webviews (pushed: 70a8953..c1b5add main -> main; confirmed on origin/main)
NEXT TASK: (1) human: Railway dashboard → takeover-api → Redeploy (or confirm
  git integration); (2) next pass: re-run the live probe (expect
  hasSessionToken:true + Bearer /me 200), then from the REPO ROOT run
  vercel deploy --dry --prod --yes --project takeover-web (confirm .env.txt +
  dist/ absent), then vercel deploy . --prod --yes --project takeover-web,
  then post-deploy checks (health 200, alias 200 HTML, preflight 204 + ACAO
  echo, live verify with redacted token, fresh-dist leak audit 0 hits);
  (3) human 14b re-test on device, then Risks B/C/D
BLOCKED BY: Railway redeploy (dashboard trigger; CLI token scope-blocked)
```

1. Files changed: 10 in commit c1b5add (6 src + 2 new test files + 2 docs) plus this handoff checkpoint (to commit next).
2. Test counts: before api 311 (27 files) + web 96 (11 files) + shared 1 → after api 324 (28 files) + web 103 (12 files) + shared 1. Zero existing tests lowered or skipped.
3. Test proving the Bearer-only CSRF exemption: `apps/api/test/bearer-auth.test.ts` → "BEARER EXEMPTION: Bearer-only credentialed POST with no Origin and no client header succeeds" (Bearer-only claim POST, no Origin/header → 200).
4. Test proving the cookie-present precedence rule: same file → "PRECEDENCE: valid cookie plus valid Bearer with a bad Origin is rejected" (cookie + Bearer + evil Origin → 403 FORBIDDEN_ORIGIN, zero rows).
5. Commit `c1b5add` pushed to origin/main (confirmed via `git log origin/main -1`).
6. Railway redeploy evidence: NONE — 3 probes (~4/8/14 min post-push) all show the old build (challenge 200, verify 200, one unchanged Set-Cookie, `hasSessionToken:false`). Health 200 throughout (non-discriminating).
7. Vercel production URL: NOT deployed (ordered after Railway; alias state unchanged and unverified).
8. Token-leak audit: NOT run (no fresh dist deployed; pre-deploy `dist/` untouched by this change — audit runs post-deploy per the brief).
9. Deployed: NO — blocked. NOT ready for human Phase 14b re-test. Exact resume: dashboard redeploy → live probe → Vercel dry-run + deploy → post-deploy checks (§NEXT TASK above).
