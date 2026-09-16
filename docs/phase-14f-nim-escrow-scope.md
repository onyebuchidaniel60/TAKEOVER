# Phase 14f — NIM custodial escrow path: scope

Status: PROPOSED (scoping phase — no code changed, no tests run).
Date: 2026-09-16.
Author: scoping agent (read-only inventory at `62ccd1d`).

## 0. Summary

Build the missing NIM rail alongside the shipped USDT rail: open the
`NIM` token gate at escrow-intent, verify escrow-wallet deposits with
a repurposed Phase 8 predicate (sender-bound — stronger than USDT
model B, and principled: same-chain identity), move every NIM fund
movement with a same-transaction double-entry `escrow_ledger` row,
sign backend release/refund/dispute-resolution sends from a
server-held escrow wallet, and enforce the ledger invariant with
halt semantics. Three phases (M, L, M). Zero schema changes required
(`payment_token` already includes `NIM`; ledger table exists). The
material decisions are the signing library (D1) and the usual
custody handling; everything else is small, named branches.

## 1. Component inventory

Conventions: (new) = create; (modify) = edit. "Depends on" is build
order. No new endpoints; no USDT behavior change (findings only,
§9).

### 1.1 Backend — escrow wallet + signing (new modules)

- `apps/api/src/escrow/nimiq/wallet.ts` (new) — escrow-wallet key
  handling mirroring `polygon/signer.ts` (lazy load, cache,
  cross-check derived address against `NIM_ESCROW_WALLET_ADDRESS`,
  generic errors, never logged/returned) + backend transaction
  build/sign/broadcast via D1. Depends on: D1, D8.
- `apps/api/src/escrow/nimiq/verify-deposit.ts` (new) —
  `assessNimDeposit` pure predicate (recipient = escrow wallet,
  exact BigInt amount, data binding §5, sender = buyer wallet,
  confirmations ≥ `REQUIRED_CONFIRMATIONS` (3, reuse), tx-hash
  assert) with `mismatch` reasons (`sender|recipient|amount|data`),
  mirroring `assessTransaction`/`assessDeposit` outcome shapes
  (`funded`-equivalent/mismatch/pending/review-timeout). Depends
  on: D5.
- `apps/api/src/escrow/nimiq/ledger.ts` (new) — `writeLedgerEntry`
  (same-tx double-entry writer) + `checkLedgerInvariant`
  (aggregate vs on-chain balance, §3). Depends on: D6.

### 1.2 Backend — token branches (modify)

- `apps/api/src/escrow/service.ts` (modify) — intent (accept `NIM`,
  store `paymentToken`, NIM instruction: wallet + amount + binding);
  submission (reuse as-is — hash shape already compatible, F2);
  verify-deposit (NIM branch: Nimiq RPC lookup + predicate +
  sender record + ledger DEPOSIT row in the funding tx); deliver
  (payout-address equality check for NIM, D4); confirm-receipt
  (NIM send + receipt poll + ledger RELEASE row at flip);
  dispute (NIM immediate backend flip, no wallet action, D7);
  admin resolve + `checkEscrowTransitions` auto-refund (NIM send +
  ledger rows). Dispatch shape §2. Depends on: §1.1 modules.
- `apps/api/src/payments/rpc.ts` (modify, additive only) — add
  balance read for the invariant check (Nimiq node `getBalance`/
  `getAccount` per node API; name pinned in implementation).
  Existing methods untouched. Depends on: nothing.
- `apps/api/src/env.ts` (modify, additive only) — schema entries
  `NIM_ESCROW_WALLET_ADDRESS` (exists) + `NIM_ESCROW_WALLET_PRIVATE_KEY`
  (new) + tolerant getters in established style (+ optional send
  fee-floor env if testnet observation demands it in P2).
- `apps/api/src/escrow/validation.ts` (modify, maybe) — only if
  the D4 payout handling needs a schema touch (default: none;
  service-layer check suffices).
- `db/verify.ts` (modify) — assert ledger table presence shapes
  already covered; add any new-column assertions only if schema
  changes (default: none — F1).

### 1.3 Reads (verify, do not assume)

- `getEscrowForBuyer/Provider`, `GET /admin/escrows` projections
  are NULL-tolerant for `contract_address`/`on_chain_escrow_id`
  (types already nullable) — P3 adds null-tolerance tests, no
  projection change expected. Lazy transitions need the §2
  dispatch (NIM wallet service in place of the Polygon client).

### 1.4 Frontend (P3 only, plugs into 14e scope)

- `EscrowPanel` token selector: enable `NIM` ( disabled
  placeholder today per 14e §8-D3); NIM deposit panel reusing
  `PaymentPanel` patterns (`sendBasicTransactionWithData` with the
  §5 binding via existing `lib/nimiq.ts` — zero new wallet code);
  status/terminal rendering already generic from 14e P1. No new
  routes, no redesign.

## 2. Token dispatch architecture

The service is USDT-shaped by assumption, not by branching: the
explicit token surface is two lines (intent gate
`service.ts:139-141`, hardcoded insert `service.ts:188`); the rest
is implicit (non-null `onChainEscrowId`/payout checks, contract
client, dispute-via-contract). The plan threads `payment_token`
through with small per-function branches — NO strategy framework,
NO premature unification with `EscrowContractClient` (which stays
USDT-only; NIM gets a parallel `NimiqWalletService` interface
beside it — flag as future, §9):

```text
route (unchanged, token-agnostic)
  → service fn loads escrow row, reads row.paymentToken once
  → NIM ? nimiqосуществ path : existing USDT path
      intent:      NIM instruction  | USDT instruction
      verify:      Nimiq RPC + assessNimDeposit | event scan + assessDeposit
      deliver:     payout equality check (D4)   | payout store
      confirm:     wallet send + Nimiq receipt poll | contract release()
      dispute:     immediate backend flip (D7)  | callData instruction + event poll
      resolve:     wallet send (release|refund) | contract release()/refund()
      auto-refund: wallet refund send          | contract refund()
      reads:       NIM wallet service for lazy transitions | Polygon client
```

Each branch is independently testable with the existing fake-client
pattern (fake `NimiqWalletService` alongside fake
`EscrowContractClient`). Shared code (locks, conditional writes,
audits, windows, confirmation envs) stays common.

## 3. Ledger design

Naming: `escrow:wallet` (omnibus custodial address),
`buyer:user:<buyerId>`, `provider:user:<providerId>`.
Movements — deposit: debit buyer / credit `escrow:wallet`;
release: debit `escrow:wallet` / credit provider; refund: debit
`escrow:wallet` / credit buyer. `tx_hash` carries the mined
on-chain hash (satisfies NOT NULL); rows represent SETTLED
movements only (deposit row at funding flip, release/refund rows
at confirmation flip — never for in-flight broadcasts).
Discipline: `writeLedgerEntry` runs inside the SAME DB transaction
as the claim/escrow state flip, mirroring `writeAuditEvent`
placement; helper signature
`writeLedgerEntry(tx, { escrowId, entryType, debitAccount,
creditAccount, amountBaseUnits, txHash })`.
Invariant SQL (exact shape):

```sql
SELECT COALESCE(SUM(CASE WHEN credit_account = 'escrow:wallet'
                    THEN amount_base_units ELSE 0 END), 0)
     - COALESCE(SUM(CASE WHEN debit_account = 'escrow:wallet'
                    THEN amount_base_units ELSE 0 END), 0)
  AS net_held FROM escrow_ledger;
```

`net_held` (bigint) must equal the escrow wallet's on-chain luna
balance at all times. Trigger + halt (defaults; D6 confirms):
lazy check on every NIM escrow mutation (mirrors the
`checkEscrowTransitions` read-gate pattern, no worker/cron);
mismatch → 503 with a dedicated code (`ESCROW_LEDGER_MISMATCH`,
the one justified new code) BEFORE any state change or
broadcast; USDT paths and reads unaffected (mutations-only halt).

## 4. Nimiq signing approach (decision D1)

- **(A) Promote `@nimiq/core` (^2.21.0, already vendored) to a
  runtime dependency (recommended default).** Official
  transaction builder/signer; the repo already proves against it
  as oracle (`nimiq-oracle.test.ts`), so conformance tests are
  free; server-side WASM load is unproblematic. Cost: reverses the
  explicit ARCH §4.5 production-code ban (doc amendment required)
  + new runtime supply-chain surface (already in tree, pinned).
- **(B) `tweetnacl` (already an api runtime dep) + hand-rolled
  Nimiq serialization.** Zero new deps, but bespoke
  consensus-adjacent code for money movement; must be proven
  against the `@nimiq/core` oracle case-for-case. Higher
  review burden, lower supply-chain delta.
- **(C) External signer sidecar.** Rejected for the competition
  build (new infra); note as the production-shaped answer
  alongside KMS.
- Fee policy (P2 detail, proven on testnet): explicit floor at or
  above observed minimums + node estimation; confirmation reuse
  (`REQUIRED_CONFIRMATIONS` = 3, existing release/refund envs —
  already token-agnostic getters, no new envs).

## 5. Data binding (decision D5)

Recommended: **`TAKEOVER:v1:<claimId>`** — the deprecated intent
precedent, UTF-8, ~48 bytes (fits Nimiq's 64-byte data field),
human-debuggable in explorers, buyer-scoped (only ever returned
to the authenticated buyer). Replay protection does not rest on
unguessability: one escrow per claim (`UNIQUE claim_id`), one
funding per escrow (conditional `created→funded`), `deposit_tx_hash`
UNIQUE across rows, tx-hash assert in the predicate. Options
considered: fresh 32-byte random hex (does not fit text-style data
with a readable prefix; buys nothing given the DB backstops);
escrow DB id (equivalent to claim id, less debuggable). NIM
additionally binds **sender = buyer's authenticated Nimiq wallet**
(same-chain identity makes this possible — a principled
strengthening over USDT model B, not a re-litigation; mismatch →
review, never funded).

## 6. Payout destinations (decision D4)

- Provider: the slot provider's authenticated `users.wallet_address`.
  The shared `mark-delivered` body still carries
  `providerPayoutAddress` (schema unchanged); the NIM branch
  REQUIRES it to equal the provider wallet (fail closed 409 on
  mismatch — explicit confirmation, mirrors immutability
  semantics) and pays the wallet regardless. Recommended.
- Buyer refund: recorded on-chain deposit sender (== buyer wallet
  under sender-binding); source of record `users.wallet_address`,
  sender persisted for audit.

## 7. Implementation phases (recommended: 3)

- **P-NIM-1 — Intent + deposit + verify + ledger foundation (M).**
  Files: `service.ts` (intent/submission/verify NIM branches),
  `escrow/nimiq/verify-deposit.ts` + `ledger.ts` (new),
  `payments/rpc.ts` (+balance), `env.ts` (+wallet getters),
  `env.test` +2. Acceptance: real testnet NIM deposit →
  `escrow_funded` with ledger DEPOSIT row and green invariant
  (E2E on testnet; NO signing needed — nothing moves out).
  Depends on: D4/D5/D6 (binding, payouts, halt semantics).
- **P-NIM-2 — Signing + all fund-out paths + invariant halt (L).**
  Files: `escrow/nimiq/wallet.ts` (new, D1), `service.ts`
  (confirm/dispute/resolve/auto-refund NIM branches),
  `ledger.ts` (release/refund rows + check). Acceptance: testnet
  NIM release to provider ANDursed refund, both with real txs;
  invariant holds; fault-injection test proves drift → 503 with
  no broadcast. Depends on: P-NIM-1, D1, D7, D8. (Dispute buyer
  step rides here: immediate flip, no wallet action — trivially
  small, no reason to isolate.)
- **P-NIM-3 — Reads hardening + NIM UI + full E2E (M).** Files:
  read-path dispatch + null-tolerance tests; `EscrowPanel` NIM
  enablement + deposit panel (14e patterns, existing
  `lib/nimiq.ts`); docs (ARCH §6 Path B "live"). Acceptance:
  UI-driven testnet NIM escrow deposit→deliver→confirm→released;
  suite green incl. a11y for new copy. Depends on: P-NIM-2 +
  14e-frontend P1 (the selector it plugs into).

## 8. Test plan

Extend: `env.test.ts` (+schema, +getter). New suites:
`nim-escrow-verify.test.ts` (predicate matrix:
sender/recipient/amount/data/confirmations/hash),
`nim-escrow-intent.test.ts` (gate open, instruction exactness,
idempotent re-intent), `nim-escrow-lifecycle.test.ts`
(funded→delivered→released/refunded via mocked wallet service +
ledger assertions per step), `nim-ledger.test.ts` (double-entry
balance, invariant SQL vs fixtures, halt-on-drift with
no-broadcast assertion), `nim-wallet.test.ts` (lazy/cache/
cross-check/generic-errors/source-scan — mirrors signer suite),
`nim-dispute.test.ts` (immediate flip, no callData, resolve
broadcast). Live: `nim-e2e.test.ts` (deposit→release on testnet).
**Funding requirement (flag): testnet NIM faucet needed for the
buyer wallet AND the escrow wallet before any live leg; owner or
tester funds both (~0.1 NIM-class amounts per the fee-floor
observation in P2).** Web (P3): token-selector enablement +
deposit-panel cases per 14e conventions.

## 9. Owner decisions required

- **D1 — Signing library.** (A) `@nimiq/core` runtime (recommended,
  §4) / (B) tweetnacl + bespoke serializer / (C) sidecar (reject).
- **D2 — Wallet cardinality.** Single omnibus escrow wallet
  (recommended — spec singular, `NIM_ESCROW_WALLET_ADDRESS` exists,
  binding+UNIQUEs disambiguate) vs per-escrow derivation (HD
  management, no demo benefit).
- **D3 — (tracked in 14e scope; restated for completeness) NIM
  now/later/never.** This plan IS the "now" design; sequencing §11
  says when.
- **D4 — Payout handling.** Equality-check-and-pay-wallet
  (recommended, §6) vs ignore-field vs separate NIM endpoint
  (reject — no new endpoints).
- **D5 — Binding format.** `TAKEOVER:v1:<claimId>` + sender bind
  (recommended, §5) vs random-hex capability.
- **D6 — Reconciliation trigger/halt.** Lazy-on-NIM-mutation +
  mutations-only 503 halt (recommended, §3) vs full halt vs
  worker/cron (reject for competition).
- **D7 — Dispute shape.** Reuse endpoint with token branch,
  immediate flip, no `disputeInstruction` for NIM (recommended)
  vs dedicated endpoint (reject).
- **D8 — Key custody for competition.** Env secret mirroring
  `ESCROW_SIGNER_PRIVATE_KEY` handling (recommended) vs KMS now
  (reject — documented production gap, as with 14d-3a).

## 10. Risks

- **Custody concentration** (low likelihood / critical impact — one
  key drains all in-flight NIM). Mitigations: signer-pattern key
  handling, minimal demo-wallet funding, KMS production gap,
  rotation procedure, mutations-halt bounds divergence impact.
- **Ledger drift** (low / high). Mitigations: same-tx discipline,
  settled-only rows, lazy halt.
- **Signing-dependency risk** (low-medium / high). Mitigations:
  oracle-conformance tests (existing pattern), pinned version,
  fallback option documented.
- **Faucet/testnet availability** (medium / medium). Mitigations:
  fund early (P-NIM-1 needs it), document amounts.
- **Replay/double-fund** (low / critical). Mitigations: existing
  UNIQUEs + hash assert + conditional writes (no new mechanism
  needed).
- **Fee-spike stuck sends** (medium / medium). Mitigations:
  explicit floor, confirmation polling, audit trail; P2 proves on
  testnet.
- **Scope creep into USDT refactor** (medium / low). Mitigation:
  findings-only rule (§9 of this scope).

## 11. Non-goals

HD/per-escrow derivation, multisig, cold/hot separation (beyond the
gap note), KMS integration for the competition build, mainnet,
unifying the USDT and NIM clients, confirmation-count changes,
backend changes to any USDT behavior, NIM staking/vesting tx types,
new endpoints.

## 12. Findings on the current backend (no action taken)

- **F1 — Token surface is two lines** (`service.ts:139-141` gate,
  `:188` hardcoded insert); everything else is implicit assumption
  (null-hostile escrow-id/payout checks, contract client,
  dispute-via-contract). Smaller than feared — small branches
  suffice; STOP-condition divergence NOT triggered.
- **F2 — Submission hash shape is accidentally NIM-compatible**
  (optional-`0x` hex) — reuse deliberately; tighten only if a
  review demands it.
- **F3 — `USDT_TOKEN_ADDRESS` parsed, never read** (also in 14e
  scope G1) — the NIM track needs no equivalent (wallet address
  IS served in the instruction).
- **F4 — `NimiqRpcClient` lacks a balance read** — required for
  §3; small additive extension, same file pattern.
- **F5 — No USDT bug found; no shared-abstraction refactor
  proposed.** `EscrowContractClient` stays USDT-only; NIM gets a
  parallel interface. Unification is future work, not this track.
