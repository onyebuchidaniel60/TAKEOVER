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

**Phase 4 complete — Marketplace discovery done (2026-09-11). Next: Phase 5 — Provider slot creation and lifecycle (NOT started, awaiting explicit instruction).**

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
