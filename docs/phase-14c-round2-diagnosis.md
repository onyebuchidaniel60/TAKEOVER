# Phase 14c Round 2 — Diagnosis: 14b re-test failures (publish 400, intent 500, profile unknown)

Date: 2026-09-15. Status: **DIAGNOSIS ONLY. No production code changed. Owner
review required before the completion pass.**

Round 1 (Bearer fallback) is exonerated: every failing call was reproduced with
a real Bearer token, and the failures are orthogonal to auth. Steps 1 (connect)
and 3 (browse) passing on-device is consistent with this diagnosis.

## 1. Per-failure reproduction and root cause

All probes ran against live Railway (`takeover-api-production-1511.up.railway.app`)
with throwaway wallets + real Bearer tokens, frontend-identical headers
(`content-type: application/json` always, `Authorization: Bearer`,
`Origin: https://takeover-web-gamma.vercel.app`, `X-Takeover-Client: web` on
mutations). Token values redacted everywhere. All probe rows deleted
(counts verified; provider_profiles deleted before users — FK order).

### Failure 1 — POST /slots/:slotId/publish → 400 "Invalid request." CONFIRMED

Reproduction (frontend-identical: POST, no body, `content-type: application/json`):

```text
RES 400 {"error":{"code":"INVALID_INPUT","message":"Invalid request."},"requestId":"…"}
```

Control (same request WITHOUT the content-type header):

```text
RES 200 {"data":{"slot":{…,"status":"published",…}}}
```

Root cause: `apiFetch` (`apps/web/src/lib/api.ts`) sets
`'content-type': 'application/json'` on EVERY request, including bodyless
POSTs (`publishSlot` and `cancelSlot` in `apps/web/src/lib/slots.ts` send no
`body`; `logout` in `apps/web/src/store/auth.ts` sends no `body`). Fastify's
default JSON parser rejects an empty body under a JSON content-type with
`FST_ERR_CTP_EMPTY_JSON_BODY` (400; confirmed in
`node_modules/fastify/lib/content-type-parser.js:319` + `lib/errors.js:122`),
and the app error handler (`apps/api/src/app.ts`) maps any 400 to
`INVALID_INPUT` / `'Invalid request.'`. The UI (`SellDetail.tsx:96`) renders
`err.message` verbatim → "Invalid request." — byte-identical to the report.

Why tests never caught it: every existing publish/cancel/logout test uses
`inject` with headers but no `payload` and NO content-type header, so
light-my-request sends no content-type and Fastify skips parsing
(`isEmptyBody` in `lib/handle-request.js`). The browser always sends the
header. Test blind spot, not a server regression.

Collateral (same bug, unreported): `POST /auth/logout` also sends no body →
also 400s on-device → its `catch {}` (`store/auth.ts`) swallows it → the
server session is NEVER revoked on logout from the app (only the local token
is cleared). The threat model's "revoke-on-logout" does not hold for
bodyless-POST clients. `POST …/cancel` has the same latent 400.

NOT Bearer-related: the 400 fires before auth-independent parsing; it
reproduces regardless of credential presentation.

### Failure 2 — POST /claims/:claimId/payment-intent → 500 "Something went wrong." CONFIRMED

Reproduction on a healthy slot (frontend-identical `{}` body): **200** with a
complete intent (`expectedAmountNim`, `expectedRecipient`, `expectedData`).
The endpoint works. Claim creation also 200s (matches the on-device
countdown), and the claim page's shown "NIM amount" comes from the slot
(`ClaimDetailPage.tsx:121`, always rendered) — consistent with intent failing
while everything else renders.

Mechanism proof (seed-condition simulation on my own throwaway row only:
create → publish → SQL UPDATE payout to a placeholder on MY row → claim →
intent → full cleanup):

```text
claim on bad-payout slot          → 200 active_hold (countdown would render)
payment-intent on that claim      → 500 {"error":{"code":"INTERNAL_ERROR","message":"Something went wrong."}}
```

Root cause chain:
- `createPaymentIntent` (`apps/api/src/payments/service.ts:84`) runs
  `canonicalizeOr500(slot.payoutWallet)`; a stored payout that fails
  canonicalization throws 500 `'Something went wrong.'` (line 27-36),
  which `PaymentPanel.tsx:59` renders verbatim → matches the report exactly,
  including "no recipient shown, wallet did not open" (both need the intent).
- Production DB scan (all slots, real canonicalizer via tsx): **21 seeded rows,
  ALL with non-canonicalizable placeholder payouts** (`NQ00…0001`–`NQ00…0021`,
  deterministic `22222222-…` seed IDs — `db:seed` dev fixtures). 8 of them are
  `published`/`sold_out` with future `starts_at`, i.e. visible and claimable
  in the feed right now. (The single non-seed row is the human's own
  `"Table for ten"` draft, created 2026-09-14T18:43Z during the re-test and
  still `draft` — data-side corroboration of Failure 1: create went through,
  publish never did.)
- The device user could not publish their own slot (Failure 1), so they
  claimed a visible pre-existing (seeded) slot → claim 200 → intent 500.
  Via the API a bad payout can never reach `published`
  (`validatePublishable`, `slots/validation.ts:106-110` → 400
  `'Cannot publish: invalid payout_wallet.'`); the seeds bypassed the API via
  direct SQL.

So Failure 2 is poisoned data + one ungraceful server edge, reached because
Failure 1 blocked the legitimate path. NOT Bearer-related.

### Failure 3 — PATCH /me/provider-profile → cause NOT identified

Reproduction with valid input (frontend-identical `{display_name: '…'}`):
**200** `{"data":{"providerProfile":{"displayName":"…"}}}`. The endpoint,
schema (`display_name`, trim, 2–60 chars, no links), Bearer-on-PATCH path,
and CSRF skip (PATCH is a mutating method; no-cookie skips — verified in
code, `csrf.ts:15-17,30-37`) all work.

What remains consistent with the report: a 400 `'Invalid display name.'`
rejection of the actually-typed name (the form has no client-side validation
— only `maxLength=60` — so <2 chars, whitespace-only, or link-like input
reaches the server and 400s), possibly paraphrased in the report; or a
transient. What would confirm it: the typed value (unknown), or the Railway
log line for that request's `requestId` (human-accessible). No server change
is proposed for this failure until that evidence exists.

## 2. Common cause or independent?

Independent bugs with a causal link in this session: Failure 1 (client
request-shape bug) is independent of Failure 2 (poisoned seed data +
ungraceful corrupt-data edge) — but Failure 1 *forced* the user onto the
seeded slot that triggered Failure 2. Failure 3 is unidentified and treated
as independent. Fixing Failure 1 alone would have let the user publish a
real-payout slot and complete the loop despite the seeds.

## 3. Smallest correct fix for each

**Fix A — bodyless mutations (publish 400, silent logout failure, latent
cancel 400). Frontend-only, no contract change:** send `body:
JSON.stringify({})` from `publishSlot`, `cancelSlot` (both in
`apps/web/src/lib/slots.ts`), and the logout `apiFetch` call
(`apps/web/src/store/auth.ts`) — matching the existing `{}` convention
already used by claim/intent/verify. Do NOT relax server parsing (the
strict 400/415 posture is load-bearing for security tests). This also
restores real server-side logout revocation on-device.

**Fix B — seed-poisoned intent 500s. Two parts:**
- **B1 — data hygiene (ops, human, no code):** DELETE the 21 seeded rows
  from the shared DB (all `22222222-…` IDs; verify zero remaining with the
  payout scan). Never run `db:seed` against the shared DB again (14a docs
  already say seeds are dev-only). NOTE: after cleanup the feed will hold
  only the human's draft until real slots are published — the 14b re-test
  must create + publish its own slot first (which Fix A unblocks).
- **B2 — product decision (owner input needed, NOT pre-decided):** what
  SHOULD intent return on corrupt slot data? Options: (1) keep the honest
  500 + clean data (no code change); (2) a 4xx with a provider-directed
  message (new error code — contract change); (3) canonical-check payout at
  create time (breaks the deliberate lax-draft "scratchpad" design).
  Recommendation: do (1) now; decide (2)/(3) separately. None of these
  touches verification predicates or RPC.

**Fix C — profile (evidence-gated, no server change proposed):** add
client-side validation to `DisplayNameForm` mirroring the server rules
(min 2 chars after trim, max 60, no links) with inline messages, so
rejections happen before the request; re-test with a valid name; optionally
check Railway logs for the original requestId. If a valid name still fails,
re-open as a new finding — do not touch auth/session/CSRF on this evidence.

Explicitly NOT proposed: auth/session/CSRF changes (no approval needed —
none of the fixes touch them), Partitioned, proxy, RPC/verification changes.

## 4. Tests proving each fix

- Web (new): publish/cancel/logout `apiFetch` calls include a non-empty
  JSON body (fetch-stub header+body assertion) — locks Fix A at the source.
- API (new, browser-faithful): POST publish WITH `content-type:
  application/json` + `{}` body and no cookie + Bearer → 200 (the exact
  request shape no existing test sends — regression test for Failure 1);
  POST logout same shape → 200 + session revoked (locks the silent-logout
  repair).
- API (new, behavior pin): intent on a corrupt-payout claim → 500
  `INTERNAL_ERROR` (pins today's honest-failure contract until/unless B2
  changes it; create via API with shape-valid-but-uncanonical payout, or
  poison-own-row as proven here).
- Ops verification (not a test): post-cleanup payout scan → 0 bad rows
  among `published`/`sold_out` future slots; feed empty until re-seeded by
  real publishes.
- Profile: web test for the new client-side validation messages
  (2-char/whitespace/link cases); device re-test with a valid name.
- Full suite must stay green (baseline api 324 + web 103 + shared 1).

## 5. Broader Bearer-path problem?

No. The Bearer path is exonerated: every failing call was reproduced WITH
Bearer, and each root cause is orthogonal to credential presentation
(request shape, stored-data validity, unidentified input). Round-1's
exemption/precedence proofs stand (13 api + 7 web tests green). One
Bearer-adjacent hygiene note: because logout 400s silently on-device,
"revoke-on-logout" currently holds only for cookie/healthy clients — Fix A
restores it for Bearer clients too, with no auth-code change.

## 6. Implementation plan for the completion pass

Files to change (production): `apps/web/src/lib/slots.ts` (`publishSlot`,
`cancelSlot` — add `{}` body); `apps/web/src/store/auth.ts` (logout call —
add `{}` body); optionally `DisplayNameForm` in `apps/web/src/routes/
Profile.tsx` (client-side validation only). No api, auth, CSRF, payment,
or schema changes (B2/C decisions excluded until approved/evidenced).
Ops (human): delete the 21 seed rows; confirm with payout scan.
Tests to add: the web body-presence tests + the two browser-faithful API
regression tests + the intent-500 pin + profile validation tests above.
Docs: `docs/phase-14-manual-test.md` troubleshooting (publish 400 class);
`AI_HANDOFF.md` checkpoint. Then redeploy BOTH services (frontend fix needs
backend? No — Fix A is frontend-only and the backend is already current;
still redeploy frontend via the established CLI flow and re-verify).

## 7. Appendix — live evidence (statuses/envelopes, tokens redacted)

- `POST /slots` (SlotForm-style full body, Bearer) → 201 draft.
- `POST …/publish` no body + `content-type: json` → 400
  `{"error":{"code":"INVALID_INPUT","message":"Invalid request."}}`;
  same minus content-type → 200 published.
- `POST …/claims` `{}` → 200 active_hold (10-min hold observed).
- `POST …/payment-intent` `{}` on healthy slot → 200 full intent.
- `PATCH /me/provider-profile` `{display_name}` → 200.
- Bad-payout simulation on own row: claim → 200; intent → 500
  `{"error":{"code":"INTERNAL_ERROR","message":"Something went wrong."}}`.
- DB scan: 21/21 seed rows fail canonicalization (8 feed-visible); the one
  non-seed row is the human's unpublished `"Table for ten"` draft.
- Residue: probe-1 leftovers repaired (profiles 1, users 2, challenges 2 —
  guard-selected, human rows untouched); probe-2 fully removed
  (intents 0, claims 1, slots 1, profiles 0, sessions 2, audits 4, users 2,
  challenges 2). Temp scripts deleted.
- Required battery (actual, run before commit): typecheck exit 0; lint
  exit 0; full suite green (api 324 + web 103 + shared 1 — re-verified, no
  prod code changed); live `/health` 200.
