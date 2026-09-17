# Phase 14g — NIM listing fee: scope

Status: PROPOSED (scoping phase — no code changed, no tests run, no migration written).
Date: 2026-09-17.
Base: `016ad3b` (origin/main, verified clean before scoping).
Author: scoping agent (read-only inventory at `016ad3b`).

## 0. Summary

Give NIM a real, non-decorative role: the seller pays a small NIM listing fee
via Nimiq Pay to publish a slot. USDT on Polygon stays the sole escrow rail;
the retired custodial NIM escrow path (14f-r) is NOT reintroduced — no escrow
wallet, no signing from the fee wallet, no ledger, no custody of any kind.
The fee wallet only receives.

Conceptual rule applied throughout: users never see Luna. Nimiq's base unit is
Luna (1 NIM = 100,000 Luna). Transaction encoding requires Luna, but the env
var is `LISTING_FEE_NIM` (decimal string like `"400"`), the backend converts
with the existing `nimToBaseUnits()` helper, the config endpoint serves a NIM
decimal string, and the frontend renders `"400 NIM"`.

Price basis (fetched 2026-09-17, CoinGecko public API, no key):
NIM/USD = $0.00038052 (`nimiq-2`). Exact NIM for $0.15 = 394.20.
Recommended pinned default: `LISTING_FEE_NIM="400"` (≈ $0.1522).

Single implementation phase, size M. One new public endpoint
(`GET /api/v1/config`); publish gains an optional fee body; no new error
codes; no new frontend dependency; no schema table — two nullable columns on
`slots` (+ migration in the implementation phase).

Seam (§12 of docs/phase-14e-frontend-escrow-scope.md v2, verified unchanged
at this base — see §4): `SellDetail.handlePublish` stays the interception
point; `publishSlot` stays the raw API call; `PublishButton` stays dumb.

## 1. Surface inventory

Conventions: (new) = create; (modify) = edit. "Depends on" is build order.

### 1.1 Backend

| File | Change | Purpose | Depends on |
|---|---|---|---|
| `apps/api/src/env.ts` | modify | Add `LISTING_FEE_NIM` + `TAKEOVER_FEE_WALLET_ADDRESS` to the zod schema (optional, empty→undefined like all other vars) + tolerant getters `getListingFeeNim()` (decimal-string-or-undefined; invalid → undefined, never throw) and `getFeeWalletAddress()` (canonical-or-undefined) | nothing (first) |
| `apps/api/src/payments/amounts.ts` | modify | Add `baseUnitsToNim()` reverse helper (exact BigInt → trimmed decimal string) for logs/config normalization. Finding F2: no reverse exists today; frontend has its own `formatNim` — the backend needs 3 lines, not a dependency | nothing |
| `apps/api/src/listing-fee/verify.ts` | new | Export `assessListingFee(tx, { sender, slotId, feeNim })` wrapping `assessTransaction` (§5). Pure, no DB, no RPC | `payments/verify.ts`, `payments/rpc.ts` (`REQUIRED_CONFIRMATIONS`, `TxRecord`), `payments/amounts.ts`, `auth/nimiq-address.ts` |
| `apps/api/src/listing-fee/service.ts` | new | `verifyListingFeePayment(db, { slotId, ownerId, txHash, rpc, now, requestId })`: loads owned draft slot, builds expected terms, RPC-looks-up the hash (outside any DB tx), assesses, maps to AppError codes (§6), records `fee_tx_hash`/`fee_paid_at` + `slot.published` audit in one conditional-write transaction; replay-safe (§9) | `listing-fee/verify.ts`, `slots/lifecycle.ts` (publish core, refactored to accept a pre-verified fee claim — or called after verification; implementation detail), `audit/events`, `http/errors` |
| `apps/api/src/routes/slots.ts` | modify | Publish route accepts optional `{ transactionHash }` via a new strict zod body (`publishBodySchema`: `{}` today stays valid; `transactionHash` reuses `txHashSchema` from `payments/validation.ts`). No-fee path calls `publishSlot` exactly as today; fee path delegates to the listing-fee service. Shares the existing `slotMutateLimiter` | `listing-fee/service.ts`, `slots/validation.ts` (new schema lives there, not in the route) |
| `apps/api/src/slots/validation.ts` | modify | Add `publishBodySchema` (strict, `{ transactionHash?: txHashSchema }`) | `payments/validation.ts` (`txHashSchema`) |
| `apps/api/src/routes/config.ts` | new | `GET /api/v1/config` serving the fee terms (§7). No auth, tolerant reads only, never secrets | `env.ts` getters |
| `apps/api/src/app.ts` | modify | Mount the config route (`/api/v1/config`). One-line registration | `routes/config.ts` |
| `db/schema/slots.ts` | modify | Two nullable columns: `fee_tx_hash TEXT UNIQUE NULL`, `fee_paid_at TIMESTAMPTZ NULL`. NULLs = pre-fee slot or fee-not-configured publish; UNIQUE on the hash is the replay backstop (Postgres treats NULLs as distinct — correct). Migration ships with the implementation phase (NOT this phase) | nothing |
| `.env.example` | modify | Document `LISTING_FEE_NIM=` + `TAKEOVER_FEE_WALLET_ADDRESS=` with the pinned demo values and the "both-set-or-no-fee" rule (§7) | `env.ts` |

Deliberately NOT touched: `payments/verify.ts` (`assessTransaction` unchanged —
the fee predicate wraps it), `payments/rpc.ts` (client reused verbatim;
`getTransactionByHash` IS on the public proxy allowlist — no balance read
needed), `escrow/service.ts` (USDT path untouched; any shared-abstraction
urge is finding F5, not work), `slots/lifecycle.ts` publish core (called, not
rewritten; the fee branch lives in the new service + route).

### 1.2 Frontend

| File | Change | Purpose | Depends on |
|---|---|---|---|
| `apps/web/src/lib/listing-fee.ts` | new | `fetchFeeConfig()` (GET /config, typed view), `sendListingFee(provider, { recipient, amountNim, slotId })` (converts NIM→Luna-safe-number via existing `parseNimToBaseUnits` + SDK guard, builds `TAKEOVER:fee:v1:<slotId>`, calls `sendBasicTransactionWithData` verbatim), `ensureListingFeePaid()` orchestration helper the handler calls | `lib/nimiq.ts`, `lib/api.ts` (`apiFetch`), `lib/slots.ts` (`parseNimToBaseUnits`, `publishSlot`) |
| `apps/web/src/lib/slots.ts` | modify | `publishSlot(slotId, opts?: { transactionHash?: string })` — body `{}` today, `{ transactionHash }` on the fee path. Backward compatible (no-fee call sites unchanged) | nothing |
| `apps/web/src/routes/SellDetail.tsx` | modify | `handlePublish` seam (§4): fetch config → if not required, publish as today; if required, pay-then-publish with fee states + retry (§4). `PublishButton` wiring unchanged | `lib/listing-fee.ts` |
| `apps/web/src/components/PublishButton.tsx` | modify (minor) | Accept the fee-flow `disabled` + label states (`Publishing…` / `Paying fee…` / `Verifying…`) — stays a dumb button, no fee logic inside | `SellDetail.tsx` states |

No new frontend dependency (`@nimiq/mini-app-sdk` already covers the transfer).

## 2. Fee display contract

One rule: Luna never reaches the user. The chain of representation:

```text
env LISTING_FEE_NIM="400"            (decimal NIM string, human-readable config)
  → backend nimToBaseUnits("400") = "40000000"   (Luna, on-chain comparison only)
  → GET /api/v1/config returns amountNim: "400"  (decimal NIM string, never Luna)
  → frontend renders "400 NIM"                   (never Luna, never floats)
```

Exact config shape (both cases):

```jsonc
// Fee configured (BOTH vars set):
{ "listingFee": { "required": true, "amountNim": "400", "walletAddress": "NQ…" } }
// Fee NOT configured (EITHER var unset — §7):
{ "listingFee": { "required": false, "amountNim": null, "walletAddress": null } }
```

`amountNim` is the canonical decimal form of the env value (trimmed,
normalized via BigInt round-trip — `"400"`, never `"400.0"`, never Luna).
`walletAddress` is the canonical (compact, uppercase) fee wallet. The SDK
`value` sent on-chain is the Luna integer as a safe JS number
(40,000,000 « 2^53 — guarded, throws client-side if ever unsafe).

## 3. Price-fetch step

- Source: CoinGecko public API, no key required (verified this session):
  `GET https://api.coingecko.com/api/v3/simple/price?ids=nimiq-2&vs_currencies=usd`
  → `{"nimiq-2":{"usd":0.00038052}}`.
  Correct id is `nimiq-2` (live; `last_updated_at` 2026-09). The sibling id
  `nimiq` is stale (price $0.028, last update Dec 2019 — the pre-migration
  token) and MUST NOT be used.
- Timing recommendation: PINNED, fetched once now. The number is baked into
  `LISTING_FEE_NIM`; no runtime price fetch exists anywhere in the plan.
  Trade-offs: pinned = deterministic, no external dependency in the publish
  path, no nondeterministic amounts in tests, demo-safe. Dynamic runtime
  pricing = the fee tracks $0.15 across volatility, at the cost of an oracle
  dependency on the money path, cache-invalidation semantics, amount-mismatch
  windows (quote vs. broadcast), and a new failure mode on publish — none of
  it justified for a demo fee. Revisit only if NIM moves >3× and the owner
  re-pins the var.
- Computation at $0.00038052/NIM: exact = 0.15 / 0.00038052 = **394.1974 NIM**.
  Round candidates: 250 → $0.0951; **400 → $0.1522 (+1.5%)**; 500 → $0.1903.
  Recommended round number: **400 NIM** (40,000,000 Luna). Nearest round
  figure to the target; comfortably above dust; single testnet faucet drip
  covers many publishes (§11).

## 4. Publish-flow integration

Current shape verified at this base — NO divergence from rescope-doc §12:

```text
SellDetail.handlePublish (SellDetail.tsx:92-105)
  → publishSlot(slotId) (lib/slots.ts:330-339)
    → POST /api/v1/slots/:slotId/publish  (body {})
      → routes/slots.ts:147-156 (body ignored) → lifecycle.publishSlot (lifecycle.ts:167-219)
```

Fee-not-configured path (EITHER env var unset): byte-identical to today.
Same call, same body `{}`, same validation, same errors. The fee branch is
dead code that never triggers.

Fee-configured path (BOTH vars set) — client-driven sequence:

```text
1. fetchFeeConfig() → { required: true, amountNim: "400", walletAddress: "NQ…" }
2. UI shows "Publishing requires a 400 NIM listing fee — Pay with NIM through Nimiq Pay."
3. sendListingFee(): SDK sendBasicTransactionWithData({
     recipient: <walletAddress verbatim>, value: 40000000,
     data: "TAKEOVER:fee:v1:<slotId>" }) → hash
4. POST /publish { transactionHash: <hash> }
5. backend verifies on-chain (§5) → 200 { slot: published } or a §6 error
6. UI refreshes (existing refreshAfter)
```

Broadcast-succeeded-verify-failed: the slot stays `draft`; NOTHING is
published optimistically. UI behavior by class:

- Retryable without re-pay (same hash re-POST): tx-not-found (chain hasn't
  seen it yet), under-confirmed (n/3 shown), RPC down, rate-limited. Copy:
  "Payment sent — waiting for confirmations (n/3). Check again." + manual
  retry button. No polling loop is built (single retry button; the publish
  POST is cheap and idempotent on the hash — see below). A 6 s / capped
  poller mirroring VerifyDepositBox is an allowed implementation detail, not
  a requirement.
- NOT retryable with the same hash (needs a NEW broadcast): sender /
  recipient / amount / data mismatch — the on-chain tx can never satisfy the
  terms. Copy must state the fee transfer is final (no refunds, §14) and show
  what to fix (usually: pay from the owner wallet / do not edit the amount).
  Frontend misuse here should be near-impossible (values come from the server
  verbatim); mismatches imply a wallet switch or tampering.

Backend idempotency on the hash: YES. Re-POST of the same `(slotId, hash)`
pair re-verifies and publishes on success (safe: the same on-chain transfer
settles the same slot exactly once — the conditional write on
`status='draft'` + `fee_tx_hash` UNIQUE admits one winner). The same hash on
a DIFFERENT slot fails closed (data binding contains the first slot's id →
data mismatch). Cross-slot replay is impossible by construction, and the
UNIQUE constraint is the DB backstop.

## 5. Verification predicate

`assessTransaction` (payments/verify.ts:84-120, Phase 8, unchanged since) is
repurposed WITHOUT modification. The new predicate wraps it:

```ts
// apps/api/src/listing-fee/verify.ts (new)
import { assessTransaction } from '../payments/verify';
import { REQUIRED_CONFIRMATIONS } from '../payments/rpc'; // reuse — do NOT invent a constant
import { nimToBaseUnits } from '../payments/amounts';

export interface ExpectedListingFee {
  sender: string;    // slot owner's authenticated wallet (users.wallet_address, canonical)
  recipient: string; // TAKEOVER_FEE_WALLET_ADDRESS (canonical)
  feeNim: string;    // LISTING_FEE_NIM verbatim ("400")
  slotId: string;    // bound into data
}

export function assessListingFee(
  tx: TxRecord | null,
  expected: ExpectedListingFee,
): Assessment; // the existing Assessment type: { outcome, confirmations, mismatch? }
```

Expected object for slot S, owner O, fee "400" (exact):

```text
sender:        O (canonical NQ…)
recipient:     TAKEOVER_FEE_WALLET_ADDRESS (canonical NQ…)
amount:        nimToBaseUnits("400") = "40000000" (Luna decimal string, BigInt-compared inside)
data:          "TAKEOVER:fee:v1:<S>" (byte-for-byte; note the `fee` segment —
               distinct from the claim binding "TAKEOVER:v1:<claimId>")
confirmations: >= REQUIRED_CONFIRMATIONS (3, reused from payments/rpc.ts:22)
hash:          the submitted transactionHash (case-insensitive assert, as today)
```

Semantics inherited: null-tx → `pending`; sender/recipient/amount/data/hash
failures → `review`-class (mapped to §6 codes by the service); null or <3
confirmations → `pending`. No conflict found — the predicate is chain-shape
agnostic (claim vs. fee differ only in expected terms), so repurposing is
clean. STOP-condition check: PASSED, no conflict to report.

## 6. Error mapping (ARCH §15 only — no new codes)

Finding F1 (not a blocker): the `PAYMENT_*` mismatch codes below exist in
ARCH §15 but are currently DORMANT — no production code emits them (both
verify paths return reason strings instead of throwing). The fee flow becomes
their first emitter. That is reuse, not invention — no STOP triggered.

| Failure mode | HTTP | Code (existing) | Notes |
|---|---|---|---|
| missing body hash when fee required / wrong-hash-format (non-hex, empty, >256 chars) | 400 | `INVALID_INPUT` | Reuse `txHashSchema` (payments/validation.ts:16-20); strict body, unknown fields rejected |
| sender mismatch (paid from non-owner wallet) | 409 | `PAYMENT_SENDER_MISMATCH` | Dormant-code first use; no state change; transfer is final (no refund) |
| recipient mismatch | 409 | `PAYMENT_RECIPIENT_MISMATCH` | Same as above |
| amount mismatch (any Luna ≠ 40,000,000) | 409 | `PAYMENT_AMOUNT_MISMATCH` | Exact BigInt equality; no tolerance, no "close enough" |
| data mismatch (wrong binding, wrong slot, foreign hash) | 409 | `PAYMENT_DATA_MISMATCH` | Covers cross-slot replay attempts |
| tx not found (chain has no such hash yet) | 404 | `PAYMENT_NOT_FOUND` | Retryable; slot stays draft; copy says "not visible yet" |
| under-confirmed (found, n < 3) | 409 | `PAYMENT_NOT_CONFIRMED` | Retryable; response carries `confirmations: n` for the n/3 UI |
| replay (hash already settled a publish — UNIQUE hit) | 409 | `PAYMENT_REPLAY` | Same hash twice across slots, or re-POST after success |
| Nimiq RPC / proxy failure | 503 | `RPC_UNAVAILABLE` | No state change; existing `RpcUnavailableError` mapping (routes/payments.ts:147-154 pattern) |
| verify too frequent | 429 | `VERIFY_RATE_LIMITED` | Per-slot 1/5 s limiter (verify-rate-limit.ts pattern) + `Retry-After` |
| fee required but caller sent `{}` | 400 | `INVALID_INPUT` | Message: listing fee of "400 NIM" required; includes the config terms |
| slot not draft / not owned / not publishable | 404/409 | `NOT_FOUND` / `SLOT_NOT_PUBLISHABLE` / `INVALID_INPUT` | Unchanged existing behavior; fee check runs AFTER ownership + publishability (never leak fee terms to non-owners — config is public anyway, but ordering stays owner-first) |
| fee half-configured (amount set, wallet unset or vice versa) | — | `INTERNAL_ERROR` (500, fail-open to no-fee path) | Coarse but existing; misconfiguration NEVER blocks publish (§7). Flagged as finding F4, not a new-code case |

No case above requires a code outside §15. STOP-condition check: PASSED.

## 7. Config endpoint

`GET /api/v1/config` — RECOMMENDED: **public** (no auth). Rationale: fee
terms (a receive-only address + a public amount) are not secrets; the publish
page needs them pre-auth for copy; authenticated-only would add a login gate
to a marketing-visible price with zero security gain (ownership is still
enforced at publish; verification is still fully server-side).

- Fee unset (EITHER var missing/blank/invalid): `{ listingFee: { required:
  false, amountNim: null, walletAddress: null } }`. Publish behaves exactly
  as today. Server logs a boot/warn line (once, not per request).
- Fee wallet unset while amount set (or amount invalid while wallet set):
  same `required: false` response (fail-open to today's path — the fee is
  revenue, not custody; a typo must not brick all publishing) + server warn
  log. The response MAY carry `"misconfigured": true` (implementation detail,
  allowed) so an admin dashboard can surface it — not a client behavior.
- Cacheability: RECOMMENDED `Cache-Control: public, max-age=300`. Terms
  change only via env + redeploy; 5 minutes bounds staleness after a fee
  change without adding invalidation machinery. Vercel edge caching is safe
  (no per-user content). `no-store` also acceptable — call it an
  implementation detail, but pick one and document it.

## 8. Fee wallet handling

`TAKEOVER_FEE_WALLET_ADDRESS` is a plain Nimiq address that RECEIVES the
listing fee. It never signs, never needs funding, needs no private key
anywhere in the system, and has no KMS story — because there is nothing to
protect: no code path sends FROM it. Contrast with the retired NIM escrow
wallet (14f-r): that wallet was custodial (backend-held key, signing releases
and refunds, double-entry ledger, on-chain-balance invariant with halt-on-
mismatch). Every one of those concepts stays retired. The fee wallet is a
receive-only sink, like a donation address; the invariant surface is zero
(no ledger writes, no reconciliation, no halt). Operational note: the wallet
should be a team-controlled address whose key lives offline; the backend only
ever string-compares against it (canonical form).

## 9. Re-publish semantics

RECOMMENDED, with justification:

- Cancel → republish requires a NEW fee payment. Each `draft → published`
  transition consumes one fee. Justification: anti-evasion (otherwise cancel/
  republish loops publish forever on one payment); simpler mental model
  ("publishing costs 400 NIM"); cancel already zeroes nothing fee-related
  because the columns live on the slot row — implementation must NULL
  `fee_tx_hash`/`fee_paid_at` on cancel OR treat any non-draft→draft reset as
  fee-clearing. The UNIQUE hash still blocks the old hash's reuse elsewhere.
- Failed publish (any §6 verification error) PRESERVES the tx hash
  client-side for retry: the slot stays `draft` with NULL fee columns, so the
  user re-POSTs the same hash (retryable classes) at zero marginal cost, or
  broadcasts fresh (mismatch classes). The backend stores nothing until
  success — no "reserved hash" state, no cleanup job, no stuck rows.

## 10. Phase breakdown

Single implementation phase (the plan does not justify two — no contract,
no migration-chain, no parallel tracks):

- **Phase 14g-1 — NIM listing fee end-to-end (M).** Objective: seller pays
  400 NIM via Nimiq Pay; publish verifies on-chain; no-fee path unchanged.
  File set: §1 tables in full (env, amounts, listing-fee/{verify,service},
  routes/slots + slots/validation, routes/config + app.ts, db migration for
  the two columns, .env.example; web lib/listing-fee, lib/slots, SellDetail,
  PublishButton). Acceptance: (a) fee-unset publish == today's behavior
  (regression suite green); (b) fee-set publish with a real testnet fee tx
  flips draft→published with `fee_tx_hash` stored; (c) each §6 mismatch class
  returns its mapped code with no state change; (d) same-hash replay across
  two slots → `PAYMENT_REPLAY`; (e) same-hash retry on one slot publishes
  exactly once. Size M (not S: new endpoint + new service + migration +
  predicate + frontend flow + four test layers exceed the §12 S estimate —
  honest re-size, scope unchanged).

## 11. Test plan

- Unit (no DB, no chain): `assessListingFee` matrix (sender/recipient/amount/
  data/hash mismatches, null-tx pending, 0/2/3/99 confirmations, null
  confirmations pending, case-insensitive hash, Luna-exactness: 39999999 and
  40000001 both mismatch); `nimToBaseUnits("400") === "40000000"` +
  `baseUnitsToNim` round-trip; env getters (unset/blank/invalid → undefined;
  valid → canonical).
- Integration (live DB, stubbed RPC): publish with fee unset (no body → 200);
  fee set + `{}` → 400 INVALID_INPUT; each mismatch → its §6 code, slot still
  draft, no audit row beyond the attempt (decide: attempt-audit or silent —
  recommend silent like mismatch no-writes, audit only success); replay
  (UNIQUE hit) → PAYMENT_REPLAY; idempotent retry same slot+hash → publishes
  once; half-configured env → no-fee behavior; rate-limit 429 with Retry-After.
- Component (mocked SDK + apiFetch): SellDetail fee states — required-fee
  copy with "400 NIM", paying/verifying/disabled button states, retryable vs.
  fatal error copy, broadcast-failure (wallet reject 4001-style) distinct from
  verify-failure, no-fee path renders zero fee UI.
- Live E2E (one, testnet): funded provider wallet pays a real testnet fee and
  publishes through the UI/API against the testnet RPC. Funding: Nimiq
  testnet faucet https://nimiq.dev/web-client/faucet (API
  https://faucet.pos.nimiq-testnet.com, up to 10,000 NIM per drip — proven in
  P-NIM-1). Budget: each publish costs exactly 400 testnet NIM + network fee
  (~1 Luna-class, negligible). A single drip of **2,000–5,000 testnet NIM**
  gives comfortable headroom for 5–12 attempts (one success + mismatch/retry
  probes, each mismatch burn being final — §14). Confirm 3 confirmations on
  the testnet proxy before asserting (allowlist covers getTransactionByHash).

## 12. Owner decisions

D1 — Default LISTING_FEE_NIM amount.
Options: (a) `"400"` (≈ $0.1522, +1.5% over $0.15); (b) `"250"` (≈ $0.095);
(c) `"500"` (≈ $0.19). Trade-offs: (a) nearest round to target, memorable,
faucet-friendly; (b) cheaper demo friction, 37% under target; (c) rounder
psychology, 27% over. RECOMMENDED: (a) `"400"`.

D2 — Config endpoint: public or authenticated.
Options: (a) public; (b) session-authenticated. Trade-offs: (a) pre-auth copy,
simpler client, terms are non-secret; (b) hides the fee wallet (security
theater — the address is on-chain after first use anyway) at the cost of a
login gate on price display. RECOMMENDED: (a) public.

D3 — Publish body: optional / required / separate endpoint.
Options: (a) optional `transactionHash` on the existing publish route
(backward compatible, one route); (b) required when fee set (same route,
`{}` → 400); (c) separate `POST /slots/:id/publish-fee` endpoint.
Trade-offs: (a)+(b) are the same implementation with different errors —
recommend BOTH: field optional in schema, required-by-policy when fee set;
(c) doubles the publish surface for no gain. RECOMMENDED: (a)+(b) combined;
no new endpoint beyond /config.

D4 — Error code for a re-used fee tx hash (replay).
Options: (a) `PAYMENT_REPLAY` (409); (b) `CONFLICT` (409). Trade-offs: (a)
says exactly what happened and matches the ARCH payment family; (b) is
generic and already used for address-immutable races. RECOMMENDED: (a)
`PAYMENT_REPLAY`.

D5 — Fee wallet: single global address or per-environment.
Options: (a) per-environment (testnet wallet for demo, mainnet wallet for
prod — same var name, different values); (b) single global address.
Trade-offs: (a) test NIM and real NIM never mix; (b) simpler but burns real
NIM in testing. RECOMMENDED: (a) per-environment (it already falls out of
env-based config — no extra work).

D6 — Failed verification preserves the tx hash for retry.
Options: (a) yes — client keeps hash, slot stays draft, re-POST free;
(b) no — hash burned, must re-pay. Trade-offs: (a) forgiving of chain lag
(the common failure), zero stuck state; (b) punishes nothing-attacker at the
cost of punishing every laggy user. RECOMMENDED: (a) preserve + retry.

D7 — Fee disclosure copy placement.
Options: (a) inline on SellDetail above Publish ("Publishing requires a
400 NIM listing fee. Pay with NIM through Nimiq Pay." — the PROJECT_SPEC §7
disclosure pattern); (b) modal pre-confirm; (c) tooltip only. Trade-offs: (a)
always visible, ARCH §20-compliant (never hide material price info); (b)
stronger consent, more UI; (c) hides price — REJECT (violates §20).
RECOMMENDED: (a), with (b) allowed as a later polish, never (c).

D8 — Pinned vs. runtime pricing.
Options: (a) pinned (`LISTING_FEE_NIM` set once from §3, redeploy to change);
(b) runtime oracle (backend fetches NIM/USD per publish). Trade-offs: see §3
— determinism vs. peg fidelity. RECOMMENDED: (a) pinned.

## 13. Risks

- R1 — Round-trip latency (RPC fetch + 3 confirmations) exceeds user
  patience. Likelihood: high on first publish (Nimiq confirmations are
  ~seconds-to-a-minute each). Impact: medium (abandoned publishes, double-pay
  attempts). Mitigation: immediate "payment sent, n/3 confirmations" copy +
  free same-hash retry (§4); consider a capped poller as an implementation
  detail; NEVER publish optimistically.
- R2 — Fee-wallet address misconfiguration (typo, wrong network, lowercase
  corruption). Likelihood: medium (one long string in env). Impact: high
  (all fee publishes fail recipient-mismatch; funds go to a dead address —
  final, no refund). Mitigation: canonical-form validation at boot with loud
  warn; fail-open to no-fee when half-configured (§7) so a typo degrades to
  free publishing instead of fund-burning; pre-launch checklist sends 1
  testnet payment to the exact env value and verifies it.
- R3 — Nimiq RPC allowlist/throttle (carried residual). The public proxy
  allowlists `getTransactionByHash`/`getBlockNumber` only (proven 14f P-NIM-1:
  `getBalance` rejected "Method not allowed") and Tenderly/Alchemy-style
  free-tier caps are already observed on the Polygon side. Likelihood: low
  for reads (fee flow needs ONLY `getTransactionByHash` — no balance read,
  no send), medium under demo load. Impact: medium (503s, retryable).
  Mitigation: reuse the 5 s timeout + `RPC_UNAVAILABLE` + per-slot limiter;
  `NIMIQ_RPC_URL` override stays available; no new RPC method is introduced
  by this phase.
- R4 — Non-refundable mismatched fee (user pays wrong amount/recipient from
  a swapped wallet; NIM is gone). Likelihood: low (server-verbatim values),
  impact: high per-incident (user trust). Mitigation: pre-send confirmation
  screen showing exact "400 NIM → NQ…" from the config response; mismatch
  copy states finality upfront; support path is manual (admin cannot reverse
  on-chain — say so in the copy, don't imply otherwise).
- R5 — Mainnet/testnet network mismatch (fee paid on testnet, backend reads
  mainnet or vice versa). Likelihood: low-medium in dev. Impact: medium
  (PAYMENT_NOT_FOUND confusion). Mitigation: `NIMIQ_RPC_URL` + `NIMIQ_NETWORK`
  documented pair in .env.example; config response MAY echo the expected
  network (implementation detail); E2E runs against the testnet proxy only.

## 14. Explicit NON-goals

Fee refunds or partial refunds; fee discounts/promo codes; multi-tier or
per-category fees; fee analytics/revenue dashboards; per-slot fee negotiation;
KMS or any private-key handling for the fee wallet (there is no key to
manage); dynamic runtime pricing / price oracle; any custody, signing,
ledger writes, reconciliation, or balance monitoring (the retired escrow
surface); admin fee-resolution UI; dispute flow for fees; fee-gated claim or
escrow paths (fee gates publish ONLY); mainnet launch checklist (separate
decision); changes to the USDT escrow flow of any kind.

## Appendix A. Findings (no action in this phase)

- F1 — Dormant `PAYMENT_*` spec codes (sender/recipient/amount/data mismatch,
  replay, not-found, not-confirmed) have zero production emitters today; the
  fee flow becomes their first user. Reuse, not invention — recorded so the
  reviewer sees the first-use explicitly.
- F2 — `apps/api/src/payments/amounts.ts` has NO reverse helper (only
  `nimToBaseUnits`); the "reverse" cited in the task brief lives only as
  `formatNim` in the frontend. The plan adds a 3-line backend helper — no
  shared package, no dependency.
- F3 — AGENTS.md (Payment bullets) + ARCHITECTURE.md (§2 diagram, §4.5
  history aside, §22 env list, §24 invariants 5–6) still describe the
  dual-rail custodial NIM escrow as active product, contradicting the 14f-r
  retirement recorded in §6/§9/§13/§16. The fee phase MUST NOT widen this
  drift (it introduces no escrow language); a doc-sync pass is a separate
  owner decision.
- F4 — No existing code fits "fee half-configured" cleanly; mapping it to
  500 `INTERNAL_ERROR` with fail-open-to-no-fee is coarse but covered — no
  new code needed, judgment call recorded in §6/§7.
- F5 — A shared "verify-NIM-transfer" abstraction over claim-payments and
  fee-payments is tempting and DECLINED here: the two flows differ in binding
  (`claimId` vs `slotId`+`fee` segment), state effects (claim transitions vs.
  slot publish), and replay scope. Duplication of ~20 lines across the thin
  wrapper is cheaper than the wrong abstraction. Flagged so a reviewer
  doesn't "fix" it mid-implementation.

## Appendix B. Verification checklist (for the implementation phase)

State at scoping: tree clean, `016ad3b` == origin/main, all 12 required files
present, publish shape matches §12, predicate repurposable, no new codes, price
source reachable, scope fits one phase. Implementation must re-verify HEAD and
re-run: targeted unit tests, integration tests (API/DB), lint, build, and the
one live testnet E2E — then STOP. Do not begin any follow-up phase.
