# TAKEOVER — Phase 12 Security Review

Date: 2026-09-12
Scope: adversarial security testing and audit only. No features, no
architecture changes, no refunds/fund movement, no provider verification.
Phase 13 NOT started.

## 1. Scope and methodology

Proved the mitigations in ARCHITECTURE.md §16 work by attacking them:

- Black-box adversarial tests over HTTP (`inject`) against the real Fastify
  app with a live Supabase Postgres, the real challenge/verify flow (injected
  signature stub — cryptography itself is proven by `crypto.test.ts` + the
  `@nimiq/core` oracle), and a mutable fake Nimiq RPC client (live wire shape
  pinned separately by `nimiq-rpc-live.test.ts`).
- Source scans for SSRF fetch sites, log-body leakage, and
  `dangerouslySetInnerHTML`, executed as tests so they regress.
- Concurrency attacks via `Promise.all` interleaving against real Postgres
  row locks. Method limit, stated plainly: one Node event loop, not
  multi-process timing — this proves serialization and fail-closed
  conditional writes; the deeper final-unit proof remains the Phase 6 8-way
  race plus the partial unique index (still passing, untouched).
- New suites: `apps/api/test/security.test.ts` (35 tests),
  `apps/api/test/security-concurrency.test.ts` (5 tests),
  `apps/web/test/security.test.tsx` (6 tests). 46 adversarial tests, all
  passing. No product behavior changed except the rate-limit additions in §4
  (F1), which are config-scale and covered by the new 429 tests.

## 2. Threat matrix (ARCHITECTURE.md §16)

| Threat | Status | Evidence |
|---|---|---|
| Auth replay — used nonce | verified | Re-verify of a consumed nonce → 401 `UNAUTHENTICATED`; race-safe single-use consume unchanged |
| Auth replay — expired nonce | verified | Forced-expired challenge → 401 `AUTH_EXPIRED` |
| Session theft — forged cookie | verified | Valid sessionId + wrong secret → 401 (constant-time hash compare) |
| Session theft — expired session | verified | Forced-expired session → 401 |
| Session theft — revoked session | verified | Logout → old cookie 401 |
| IDOR — foreign claim read | verified | Buyer B `GET /claims/:id` → 404 `CLAIM_NOT_FOUND`; anon → 401 |
| IDOR — foreign payment actions | verified | B intent/submit/verify on A claim → 404 |
| IDOR — foreign slot mutation | verified | B patch/publish/cancel on A draft → 404, row untouched |
| IDOR — foreign demand view | verified | B `GET /me/slots/:id/claims` → 404; anon → 401 |
| IDOR — draft detail / payout leak | verified | Non-owner and anon → 404 with no `payout_wallet` in body |
| IDOR — list isolation | verified | `/me/slots` and `/me/claims` exclude other owners' rows |
| Role forgery | verified | `role`/`verified` in slot/profile/verify bodies → 400 strict; `x-role` headers ignored; role read from DB only |
| SQL injection — shaped inputs | verified | `' OR '1'='1`, `'; DROP TABLE users; --` as wallet/tx-hash → 400; tables intact |
| SQL injection — free text | verified | Injection strings in title/display_name/report details stored verbatim via parameterization; tables intact |
| SQL injection — search | verified | Evil `q`/`category` (`' OR…`, `%`, `_`, `\`) → 200 with zero matches (LIKE-escaped, exact category) |
| XSS — API response | verified | `<script>`/`<img onerror>`/`javascript:` round-trip byte-exact as inert JSON, never rendered HTML |
| XSS — frontend render | verified | Hostile title/description/category/location/display-name/error-message render as text; zero `dangerouslySetInnerHTML` in `apps/web/src` |
| CSRF — cross-origin preflight | partial | Unlisted origin preflight → no ACAO header; allowlisted origin echoed with credentials (test on a state-changing route) |
| CSRF — simple form POST | partial | urlencoded POST with valid cookie → 400/415, zero rows written (JSON-only strict bodies fail closed) |
| CSRF — token hardening | escalated | No anti-CSRF token; prod `SameSite=None` sends cookies cross-site (required by the Vercel→Railway topology). See F4 |
| SSRF | verified | Only `payments/rpc.ts` fetches server-side; fixed env-or-default base, never user input; URL-shaped hash rejected pre-fetch with zero RPC calls |
| Brute force — auth endpoints | verified | Over-budget challenge/verify → 429 `RATE_LIMITED` with envelope |
| Brute force — verify-payment | verified | Second rapid call → 429 `VERIFY_RATE_LIMITED` + `retry-after` |
| Brute force — reports | verified | 6th report in the hour → 429 `REPORT_RATE_LIMITED` |
| Brute force — new budgets | verified | Claim-create, slot-create (per-user; second account unaffected), slot-mutate, profile, admin backstop each → 429 |
| Payment replay | verified | Same hash on two claims → 409; second claim still payable with its own hash (Phase 7 guard intact) |
| Amount manipulation | verified | Off-by-one amount → `review`/`amount_mismatch`, never paid |
| Recipient manipulation | verified | Published payout immutable (PATCH → 409); intent recipient equals the published payout |
| Sender spoofing | verified | Foreign sender → `review`/`sender_mismatch` |
| Transaction-data spoofing | verified | Correct triple + wrong data → `review`/`data_mismatch` |
| Race — claim vs admin disable | verified | Exactly one wins (200/409 XOR); sold_out+1 hold XOR cancelled+0 live |
| Race — verify vs admin disable | verified | Terminal combo is `paid/verified` XOR `payment_review/submitted`; slot cancelled, avail 0; ≤1 verified audit |
| Race — verify vs review resolve | verified | One terminal state; concurrent verifies 200 race-noops; second resolve → 409; exactly one `payment_review.resolved` audit |
| Race — submit vs hold expiry | verified | 200+hash recorded XOR 409 `CLAIM_EXPIRED`; repeated sweeps never double-restore |
| Race — disable vs in-flight claim | verified | Clean 200 (row+decrement+audit) XOR clean 401 `ACCOUNT_DISABLED` (no row, stock intact); never partial |
| Secret leakage — error shape | verified | 9 codes (400/401/403/404/409/413/400-for-text-plain/429/503) + forced 500: generic envelope + `requestId` + `x-request-id`, no stacks/SQL/paths |
| Secret leakage — logs | verified | Source scan: no `console.log`, no log line touching body/signature/cookie/token/secret; verify route logs `result.audit` only |
| Secret leakage — cookies/env | verified | Prod flags `Secure+HttpOnly+SameSite=None`; dev `Lax` without `Secure`; `web/dist` (33 files): 0 key-name hits, 0 secret-value hits |
| Admin escalation (7 endpoints) | verified | Anonymous → 401, non-admin → 403 `FORBIDDEN`, never 404, on all of reports/resolve/slot-disable/user-disable/reviews/resolve/audit-events |
| AI prompt injection | N/A | No AI in MVP; no LLM-backed path exists anywhere in the stack |

## 3. Test inventory (one line each)

`apps/api/test/security.test.ts`:

1. Reusing a consumed nonce → 401 `UNAUTHENTICATED` with requestId.
2. Expired challenge → 401 `AUTH_EXPIRED`.
3. Forged cookie (valid sessionId, wrong secret) → 401.
4. Expired session → 401.
5. Revoked session after logout → 401.
6. Buyer B cannot read buyer A claim (404) and anonymous cannot (401).
7. Buyer B cannot mint intent/submit/verify on A claim (404 ×3).
8. Provider B cannot patch/publish/cancel A slot (404 ×3, row untouched).
9. Provider B cannot list A slot claims (404); anonymous 401.
10. Non-owner/anon never see draft detail or `payout_wallet`.
11. `/me/slots` and `/me/claims` exclude other owners' rows.
12. `role`/`verified` in bodies → 400; admin headers ignored; role stays DB-read.
13. Injection payloads as wallet addresses → 400; users table intact.
14. Injection payloads in title/display_name/report details stored verbatim; tables intact.
15. Non-hex tx hash → 400; evil `q`/`category` (quotes, `%`, `_`, `\`) → 200 with zero matches.
16. `<script>`/`<img onerror>`/`javascript:` round-trip as inert JSON.
17. Preflight from unlisted origin → no ACAO; allowlisted origin echoed with credentials.
18. urlencoded form POST with valid cookie → 400/415 with zero rows written.
19. Only `payments/rpc.ts` fetches; env-or-default URL unit-pinned; URL-shaped hash → 400 with zero RPC calls.
20. Over-budget auth challenge → 429 `RATE_LIMITED` with requestId.
21. Over-budget auth verify → 429 `RATE_LIMITED`.
22. 6th report in the hour → 429 `REPORT_RATE_LIMITED`.
23. Second rapid verify-payment → 429 `VERIFY_RATE_LIMITED` + `retry-after`.
24. New budgets (claim-create, per-user slot-create, slot-mutate, profile, admin) each → 429; second account unaffected by the first's slot budget.
25. Same tx hash on two claims → 409; second claim payable with its own hash.
26. Off-by-one amount → review/`amount_mismatch`, claim `payment_review`.
27. Published payout immutable (PATCH → 409); intent recipient equals published payout.
28. Foreign-sender tx → review/`sender_mismatch`.
29. Correct triple with wrong data → review/`data_mismatch`.
30. Nine error codes carry `{error,requestId}` + matching `x-request-id` with no stacks/SQL/paths/secrets.
31. Corrupt stored payout forces a generic 500 `INTERNAL_ERROR` with requestId and no internals.
32. `NODE_ENV=production` cookie flags are Secure/HttpOnly/SameSite=None.
33. Source scan: no console output and no log line touching bodies/credentials in `apps/api/src`.
34. `web/dist` contains no secret key names and no configured secret values.
35. All 7 admin endpoints → 401 anonymous / 403 non-admin, never 404.

`apps/api/test/security-concurrency.test.ts`:

36. Claim POST vs admin slot disable: exactly one 200, invariants hold both ways.
37. Verify-payment (delayed matching RPC) vs admin slot disable: `paid/verified` XOR `payment_review/submitted`, slot cancelled, ≤1 verified audit.
38. Verify-payment vs admin review resolution: single terminal state, race-noop verifies, second resolve 409, one audit.
39. Payment submission vs hold expiry: hash recorded XOR `CLAIM_EXPIRED`; repeated sweeps never double-restore.
40. Admin user disable vs in-flight claim: clean 200 XOR clean 401, never partial, account stays disabled.

`apps/web/test/security.test.tsx`:

41. SlotCard renders hostile title/description/category/location as inert text.
42. SlotDetail renders hostile fields as inert text.
43. Profile renders a hostile provider display name as inert text.
44. A hostile server error message renders as inert text.
45. No `dangerouslySetInnerHTML` (or raw `innerHTML`) in `apps/web/src`.
46. State-changing client posts are JSON-only with `credentials: include`.

## 4. Findings

| ID | Severity | Description | Disposition | Rationale |
|---|---|---|---|---|
| F1 | medium | Six mutating surfaces had no rate limit: `POST /slots/:id/claims`, `POST /slots`, PATCH/publish/cancel slot, `GET /me/slots/:id/claims`, `PATCH /me/provider-profile`, all `/admin/*` | fixed | Small scope, no arch change. Added per-IP budgets (claim-create 60/min; slot-mutate 60/min; provider-claims 120/min; profile 60/min; admin backstop 120/min) and a per-user slot-create budget (30/hour) via a new `createUserRateLimiter`; every budget trips to 429 in tests. Exact values are config per ARCH §14 |
| F2 | high | `drizzle-orm` <0.45.2: SQL injection via identifiers (GHSA-gpj5-g38j-94v9); installed 0.36.4, fix 0.45.2 flagged semver-major | escalated | 0.36→0.45 in a 0.x line is not a safe targeted bump — do NOT upgrade blindly. Not reachable through our patterns: identifiers are static, user input travels only as parameterized values + Zod (proven by tests 13–15). Owner decision: schedule a dedicated dependency pass with full regression, or accept with this mitigation |
| F3 | low | Dev-only vulns: vitest critical (UI server RCE), vite high + 6 moderates (traversal/dev-server) | accepted | Fixes require breaking majors (vitest 5, vite 8; Phase 11 pins vitest 2 + vite 5). Never shipped: devDependencies are absent from Railway/Vercel production bundles. Document and defer |
| F4 | medium | No anti-CSRF token; prod `SameSite=None` (topology-required) sends cookies on cross-site requests | escalated | Current posture blocks what was tested (preflight rejects unlisted origins; non-JSON posts fail closed; HttpOnly+Secure). Adding token/header rotation changes the client/server contract and is architecture-adjacent — NOT implemented per phase scope. Owner decision for Phase 13/14 |
| F5 | low | All limiters (old and new) are in-memory per process | accepted | Documented standing note (single-region MVP). Multi-instance deployment needs shared storage — deployment item for Phase 14, fail-closed direction preserved |
| F6 | info | `text/plain` POST yields 400 (parsed-then-Zod-rejected), not 415 | accepted | Observation only: still fails closed with the generic envelope; CSRF test asserts the closed outcome, not the code |

Two test-authoring mistakes were caught by the suite itself and corrected
(not product findings): a verify-budget test seeded a matching tx so the
first call verified instead of staying pending; a resolve-race test expected
`review` from verifies landing after the admin resolution, which correctly
report the new terminal state `verified`. Both now assert the intended
semantics.

## 5. Dependency audit summary

`npm audit --json` (no `audit fix`, lockfile untouched):

- Total: 1 critical, 2 high, 6 moderate — identical to the known baseline.
- Runtime (`--omit=dev`): exactly 1 — `drizzle-orm` high (F2, escalated).
  No runtime criticals. All other runtime deps
  (fastify, `@fastify/cookie`, `@fastify/cors`, `@noble/hashes`, `pg`,
  `tweetnacl`, `zod`) are clean.
- Dev-only: vitest critical (GHSA-5xrq-8626-4rwp — UI server file
  read/exec; UI server never runs here), vite high (GHSA-fx2h-pf6j-xcff
  Windows `server.fs.deny` bypass) + vite moderate pair, esbuild moderate,
  drizzle-kit chain (3), `@vitest/mocker`/vite-node moderates. All deferred
  per F3 unless trivial (none are — majors required).
- `package-lock.json` is committed (`git ls-files`) and consistent
  (`npm install --package-lock-only --dry-run`: up to date, exit 0).

## 6. Secret hygiene summary

- `apps/web/dist` (33 files, fresh production build): 0 hits for
  `DATABASE_URL`/`SESSION_SECRET`/`NIMIQ_RPC_URL`/`ADMIN_WALLET_ADDRESSES`
  key names and 0 hits for configured secret values (count-only grep;
  values never printed). Vite inlines only `VITE_*`; none exist.
- Error responses for 9 distinct codes (400/401/403/404/409/413/400/429/503)
  plus a forced 500: every body is `{error:{code,message},requestId}`,
  every response carries a matching `x-request-id`, and no body matches
  stacks, SQL text, connection strings, internal paths, or env names.
- Request logs: `request.log` appears only as `error(error)` (unexpected
  500s, server-side only) and `info({...result.audit})` (field-level reason
  codes, never values/bodies); no `console.log` in `apps/api/src`.
- Cookies: production `Secure + HttpOnly + SameSite=None` (cross-site
  Vercel→Railway), development `HttpOnly + SameSite=Lax` without `Secure`
  (local HTTP). Verified by unit test, not by reading secrets.
- `DATABASE_URL`, session secrets, and admin wallet addresses were never
  printed in outputs, logs, commits, or test assertions (presence
  booleans and filename-only failure output throughout).

## 7. Residual risks and Phase 14 items

1. **Owner decision — F2**: accept the drizzle-orm mitigation or schedule
   the 0.36→0.45 upgrade as a dedicated dependency pass with full
   regression (test suite + manual claim→pay→verify loop).
2. **Owner decision — F4**: accept the CORS+JSON-only CSRF posture or
   approve anti-CSRF tokens (contract change, needs design).
3. Public Nimiq RPC has no uptime guarantee (pre-existing): outage → 503 +
   client backoff, never a paid marking. Self-hosted fallback via
   `NIMIQ_RPC_URL` documented in `.env.example`.
4. Real Nimiq Pay round-trip (live wallet broadcast + on-chain read) is
   still a Phase 14 verification item; the SDK path is mock-covered only.
5. In-memory limiter state (F5) must move to shared storage if the backend
   ever runs multi-instance.
6. Concurrency proof is single-process interleaving against real row locks;
   a multi-connection soak (e.g., parallel workers racing the final unit)
   would strengthen Phase 6 further but found nothing here.
7. No refunds, fund movement, provider verification, or payment-predicate
   changes were made — all out of scope and untouched.
