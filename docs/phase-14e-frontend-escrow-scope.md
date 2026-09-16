# Phase 14e — Frontend escrow UI: scope

Status: PROPOSED (scoping phase — no code changed, no tests run).
Date: 2026-09-16.
Author: scoping agent (read-only inventory of backend + frontend at `e5abeae`).

## 0. Summary

Replace the deprecated direct-payment UI with a USDT-escrow buyer flow
(intent → approve → deposit → verify → confirm/dispute), add the
provider delivery + contact-note surfaces, cover terminal states and
(optionally) admin escrow resolution, and retire the dead payment
code. Three implementation phases (M, M, S). The single largest
unknown is external, not technical: whether Nimiq Pay's WebView
exposes `window.ethereum` (§8, D2). No backend changes are proposed;
two backend serving gaps are flagged as findings (§9).

## 1. Surface inventory

Conventions: (modify) = edit existing file; (new) = create;
(delete) = remove, phased per §5. "Depends on" is build order, not
runtime.

### 1.1 New shared client code

- `apps/web/src/lib/escrow.ts` (new) — escrow API client. Types
  `EscrowView`, `DepositInstruction`, `DisputeInstruction` mirroring
  the backend projections (snake_case, string amounts); functions
  `createEscrowIntent`, `submitDepositReference`, `verifyDeposit`,
  `markDelivered`, `confirmReceipt`, `raiseDispute`, `fetchEscrow`;
  `USDT_DECIMALS`-aware amount formatter (BigInt, mirrors
  `formatNim`); poll-delay helpers mirroring `nextVerifyPollDelayMs`
  with escrow-appropriate budgets (§4). Depends on: nothing (first).
- `apps/web/src/lib/evm.ts` (new) — `window.ethereum` wrapper.
  Detects provider, requests accounts, asserts/switches to Amoy
  (chainId 80002), sends `approve` / `deposit` / `dispute`
  transactions, polls `eth_getTransactionReceipt`. Calldata for the
  three fixed call shapes via a tiny local encoder over the shared
  `ESCROW_CONTRACT_ABI` (+ 2-line ERC-20 approve fragment), OR viem —
  decision D1. Rejects non-hex/zero addresses before sending;
  surfaces user-rejection vs. RPC-failure distinctly. Depends on:
  `lib/escrow.ts` types, D1, D7 (chain/token config source).

### 1.2 Buyer flow (claim detail)

- `apps/web/src/components/EscrowPanel.tsx` (new) — buyer escrow
  flow for one claim: token select (USDT enabled; NIM
  placeholder-disabled per D3), deposit-instruction display (amount,
  contract, escrow id, exact approval), approve → deposit stepper
  with broadcastLost-style no-double-spend guard (cf. PaymentPanel),
  submission, verify polling box, confirm-receipt polling box,
  dispute action, terminal read-only states, gated contact-note
  display. Depends on: `lib/escrow.ts`, `lib/evm.ts`.
- `apps/web/src/components/VerifyDepositBox.tsx` (new) — polls
  `verify-deposit`; states pending / mismatch(reason) /
  review-timeout / funded / rpc-down / rate-limited / exhausted +
  always-available manual check. Mirrors `VerifyPollBox` structure
  (approach, not code). Depends on: `lib/escrow.ts`.
- `apps/web/src/components/ConfirmReceiptBox.tsx` (new) — polls
  `confirm-receipt`; shows confirmations `n/3`, pending / released /
  rpc-down / exhausted + manual check. Depends on: `lib/escrow.ts`.
- `apps/web/src/routes/ClaimDetailPage.tsx` (modify, large) —
  renders `EscrowPanel` for escrow-flow claims; keeps legacy
  branches for legacy rows (§5); wires refresh-on-terminal.
  Depends on: above three.
- `apps/web/src/components/ClaimStatusBadge.tsx` (modify) — add
  labels/styles for `deposit_submitted`, `escrow_funded`,
  `delivered`, `disputed`, `releasing`, `refunding`, `released`,
  `refunded` (today unknown statuses fall through to the raw
  string). Locked Phase-11 copy style (text, never color alone).
- `apps/web/src/components/ClaimCard.tsx` (modify) — escrow-aware
  link labels; no countdown change (countdowns stay hold-only;
  escrow deadlines render as static dates, §2).
- `apps/web/src/lib/slots.ts` (modify) — extend `ClaimView` with
  optional `provider_contact_note` + `deposit_submitted_at`
  (DIVERGENCE §1.5); re-bucket `groupClaimsForBuckets` so every
  escrow status lands in exactly one bucket (today escrow statuses
  match NO bucket and are invisible in `/claims`); phased deletion
  of deprecated writers (§5).

### 1.3 Provider flow

- `apps/web/src/routes/SellDetail.tsx` (modify) — demand section:
  per-claim rows from existing `fetchSlotClaims` (already used in
  `Sell.tsx`), each linking to the claim and, when
  claim=`escrow_funded`, exposing mark-delivered (placement decision
  D5). Depends on: `lib/escrow.ts`.
- `apps/web/src/components/MarkDeliveredForm.tsx` (new) — payout
  address input (0x + 40 hex, checksum-agnostic, lowercased
  server-side), idempotent resubmit, 409-CONFLICT messaging for a
  changed address. Depends on: `lib/escrow.ts`.
- `apps/web/src/components/ContactNoteForm.tsx` (new) — set/clear
  the 1–500-char no-URL note (mirrors server rules client-side for
  UX only); lives on the sell side. Buyer display renders inside
  `EscrowPanel` whenever the claim view carries a non-null note
  (backend already gates; UI renders-what-it-gets). Depends on: new
  lib function for `PATCH /me/slots/:slotId/contact-note` (no lib
  function exists today — part of `lib/escrow.ts` or `lib/slots.ts`
  addition).

### 1.4 Admin (conditional on D4)

- `apps/web/src/routes/admin/AdminEscrows.tsx` (new) — status
  filter (eight escrow states), list with reconciliation columns
  (amounts, payout, on-chain id, tx hashes, timestamps — never
  secrets), resolve dialog (release/refund + 5–1000-char notes)
  reusing `AdminTable` + `ResolveDialog` patterns; `robots=noindex`
  via `usePageMeta` like other admin routes.
- `apps/web/src/App.tsx` (modify, only if D4-yes) — lazy route
  `/admin/escrows` inside `AdminSection` + nav entry following the
  `AdminPaymentReviews` wiring.

### 1.5 Deprecation removals (phased, §5)

- `apps/web/src/components/PaymentPanel.tsx` (delete) — replaced by
  `EscrowPanel` as the `active_hold` writer. Safe: DB holds 2
  `active_hold` rows, both flow into escrow-intent (allowed state).
- `VerifyPollBox` + `payment_pending` branch in `ClaimDetailPage`
  (delete) — only after zero `payment_pending` rows remain (2 exist
  today); until then they stay rendered but unreachable for new
  claims.
- Deprecated lib writers in `lib/slots.ts` (delete, same gate):
  `createPaymentIntent`, `submitPayment`, `verifyPayment`,
  `PaymentIntent`, `VerificationResult`, `baseUnitsToSafeNumber`
  (verify exclusive use), `VERIFY_POLL_*`,
  `nextVerifyPollDelayMs`, `VerifyPollOutcome`. Keep: everything
  else (`fetchClaim`, buckets, claim CRUD, validators).
- DIVERGENCE (backend wins): frontend `ClaimView`
  (`lib/slots.ts:443`) lacks `provider_contact_note` and
  `deposit_submitted_at`, both served by the backend claim
  projection. Frontend type must grow optional fields; no backend
  change needed.

## 2. State-driven behavior matrix

Ground truth: ARCHITECTURE.md §8 + FR-12. Pairs are
(claim.status / escrow.status). Countdowns: hold only live-ticks
(`HoldCountdown` unchanged); escrow deadlines render as static
localized dates with urgency copy (delivery/dispute), avoiding a
second live-ticker surface and its a11y bands.

| Claim / escrow | Buyer sees | Buyer actions | Provider sees | Provider actions |
|---|---|---|---|---|
| `active_hold` / none-or-`created` | EscrowPanel: token select, instruction, approve→deposit stepper | Fund (USDT) | Demand row: hold, no payout yet | None (note editable anytime) |
| `deposit_submitted` / `created` | VerifyDepositBox (auto-poll + manual) | Check status | Demand row: "buyer paid, verifying" | None |
| `deposit_submitted` mismatch | Reason-specific copy, no write | Retry deposit (new submission blocked while submitted → support path copy) | Same as above | None |
| `payment_review` / `created` | Amber review box (existing copy) | None (wait) | Demand row: review | None |
| `escrow_funded` / `funded` | Funded confirmation + contact note (when present) + delivery deadline date | None (wait for delivery) | Demand row + **Mark delivered** (payout form) | mark-delivered |
| `delivered` / `delivered` | Confirm box (n/3) + dispute button + dispute deadline + contact note | Confirm receipt; dispute (gets `callData` instruction → wallet send → re-poll) | Demand row: delivered (+ payout shown) | None (address immutable) |
| `delivered`→`disputed` / `disputed` | Disputed state + admin-decides copy | None | Disputed state (+ resolution held back per backend views) | None |
| `releasing`/`refunding` (escrow-side, claim still `disputed`/`escrow_funded`) | "Finalizing on-chain" pending copy | None | Same | None |
| `released` / `released` | Terminal receipt (tx hash, amount, contact note) | None | Terminal receipt | None |
| `refunded` / `refunded` | Terminal refund copy (note hidden per gate) | None | Terminal refund copy | None |
| Legacy `payment_pending`/`paid`/`payment_review` | Existing branches unchanged | Existing (until §5 deletion) | Existing | Existing |
| `expired`/`cancelled` | Existing branches unchanged | Re-claim | Existing | Existing |

## 3. Wallet interaction plan

No existing helper (verified: zero `window.ethereum` references in
`apps/web`). New `lib/evm.ts` performs, in order: (1) provider
presence check → "open in an EVM browser" guidance when absent
(D2 decides the Nimiq-Pay-hosted story); (2) `eth_requestAccounts`;
(3) `eth_chainId` assert `0x13882` (80002, Amoy) else
`wallet_switchEthereumChain`, falling back to
`wallet_addEthereumChain` with explicit Amoy params on 4902;
(4) `eth_sendTransaction` for `approve(token, spender=escrow,
exactAmount)`, then `deposit(escrowId, amount)` to the escrow
contract, then (dispute path) `dispute(escrowId)` using the
server-provided `callData` verbatim; (5) `eth_getTransactionReceipt`
poll (2 s cadence, ~30 attempts) before advancing the stepper —
then submit the wallet-returned hash via escrow-submission
(idempotent on identical hash; `PAYMENT_ALREADY_SUBMITTED` on a
changed hash while submitted → support copy, never auto-repay).
All amounts stay BigInt base-unit strings end to end (USDT 6
decimals; formatter mirrors `formatNim`); addresses validated
`0x`+40-hex before sending; user-rejection (4001) vs RPC failure
surfaced distinctly; nothing auto-retries a broadcast
(`broadcastLost` precedent from PaymentPanel).

## 4. Polling plan

Mirrors the proven `nextVerifyPollDelayMs` approach (constants +
pure scheduler + manual-check escape hatch), retuned for escrow
limiters: `verify-deposit` poll every **6 s** (per-claim limiter is
1/5 s — stay under it), cap **60 attempts** (~6 min); mismatch or
`review` stops polling with reason copy; 503/`ESCROW_CONTRACT_UNAVAILABLE`
→ 15 s backoff; 429 → `Retry-After` else 10 s. `confirm-receipt`
poll every **15 s** (per-IP 10/60 s shared across claims), cap **24
attempts** (~6 min ≫ 3 confirmations on healthy Amoy); show
`confirmations` n/3 when served; 503 → 15 s backoff (surface
requestId in dev-shaped copy for support triage); 409
`CLAIM_NOT_PAYABLE` → reload true state. Both boxes: exhausted →
"still pending, check again" + manual button, never silent.

## 5. Deprecation plan

DB evidence (read-only count, 2026-09-16): 2 `active_hold`, 2
`payment_pending`, 3 `paid`, 6 `payment_review`, 2 `expired`, 2
`cancelled`; 15 `payment_intents` rows. Order: (i) ship escrow UI
alongside — `active_hold` renders the escrow flow, all legacy
branches keep rendering legacy rows; (ii) delete `PaymentPanel`
+ deprecated writers once the escrow entry replaces the only
`active_hold` writer (safe immediately: both live `active_hold`
rows are escrow-eligible); (iii) delete `VerifyPollBox` +
`payment_pending` branch only after zero `payment_pending` rows
remain (2 today — they must age out or be admin-resolved first);
(iv) badge/bucket legacy labels stay indefinitely (harmless maps).
Backend deprecated endpoints are out of scope and stay live.

## 6. Implementation phases (recommended: 3)

Constraint honored throughout: after every shipped phase the app
works; P1+P2 ship as one demo increment (P1 alone would let buyers
lock funds with no release UI — the two commits land together, no
demo between).

- **P1 — Buyer escrow loop (M).** Objective: fund → verify →
  confirm/dispute-instruction → terminal, all buyer-side, on
  Amoy testnet. Files: `lib/escrow.ts`, `lib/evm.ts` (new);
  `ClaimDetailPage`, `ClaimStatusBadge`, `ClaimCard`, `lib/slots.ts`
  types+buckets (modify); `EscrowPanel`, `VerifyDepositBox`,
  `ConfirmReceiptBox` (new). Acceptance: scripted wallet funds a
  real 1.5 USDT escrow to `released` through the UI (E2E on
  testnet) + new suites green. Depends on: D1, D2-fallback copy,
  D7, D3-placeholder.
- **P2 — Provider loop + contact note (M).** Objective: demand
  rows, mark-delivered, note set/display, dispute wallet-send
  completion. Files: `SellDetail`, `lib/slots.ts` (contact-note
  fn), `MarkDeliveredForm`, `ContactNoteForm` (new); buyer note
  render in `EscrowPanel`. Acceptance: provider delivers via UI;
  buyer sees note only post-funding (negative test pre-funding);
  dispute `callData` round-trips through the wallet. Depends on:
  P1, D5.
- **P3 — Admin (conditional) + deprecation + a11y (S).**
  Objective: `AdminEscrows` + resolve (skip entirely if D4-no),
  delete `PaymentPanel`/deprecated writers (gate §5), extend
  a11y/keyboard/route-state suites, full-battery green.
  Acceptance: admin resolves a test dispute via UI (or explicit
  skip recorded); `git grep` shows zero references to deleted
  writers; web 16+ suites green. Depends on: P1+P2, D4, D6.

## 7. Test plan

Extend: `verify-poll.test.ts` pattern → new `verify-deposit-poll`
cases; `payment-flow.test.ts` → escrow-flow cases (or new file
below); `request-bodies.test.ts` (intent/submission/deliver/
resolve bodies); `dashboards.test.ts` (card/bucket reshuffle);
`moderation.test.ts` pattern → admin escrow (if D4);
`a11y-routes`, `keyboard-focus`, `route-states` (new/changed
routes + dialog focus in deliver/dispute/resolve dialogs).
New suites (names, not code): `escrow-flow.test.tsx` (buyer
stepper transitions with mocked `apiFetch` + stubbed ethereum),
`evm-wallet.test.ts` (calldata vectors for approve/deposit/
dispute vs hand-computed hex; chain-switch 4902 fallback;
4001-vs-RPC error mapping), `deposit-poll.test.ts` (6 s cadence,
60-cap, 429/503 backoffs, mismatch stop), `confirm-poll.test.ts`
(15 s cadence, n/3 display, 409 reload), `contact-note.test.tsx`
(gated display + 500-char/no-URL client validation),
`mark-delivered.test.tsx` (409-CONFLICT copy),
`escrow-buckets.test.ts` (every status lands in exactly one
bucket). `vitest.config.ts` needs no change (jsdom-per-file
convention stands).

## 8. Owner decisions required

- **D1 — Calldata encoding dependency.** Options: (a) raw
  `window.ethereum` + tiny local encoder over shared
  `ESCROW_CONTRACT_ABI` (recommended default: three fixed shapes,
  zero new deps, deterministic); (b) add `viem` to web (already a
  backend dep; heavier bundle, familiar API); (c) `ethers`.
  Trade-off: (a) least supply-chain, hand-verified vectors; (b)/(c)
  less bespoke code, larger bundle + new audit surface.
- **D2 — window.ethereum inside Nimiq Pay (THE question).**
  Finding: zero EVM code in `apps/web`; SDK `provider.d.ts` has no
  ethereum surface (Nimiq-only); SDK README acknowledges apps "can
  also run outside Nimiq Pay (standalone browser dev, etc.)" but
  says nothing about injected EVM providers. Unknown whether the
  Nimiq Pay WebView exposes `window.ethereum`. Options: (a) probe
  it (recommended first step: open a probe page in Nimiq Pay,
  report `typeof window.ethereum`); (b) assume absent → ship USDT
  as browser-handoff flow ("open in browser" deep link carrying
  the claim id; session travels via Bearer in sessionStorage —
  same-device assumption must hold); (c) assume present → pure
  Mini App flow. If (b): copy + deep-link design needed; if the
  Mini App must work standalone, the unbuilt NIM path (D3) becomes
  load-bearing.
- **D3 — NIM escrow path.** Options: now / later / never.
  Spec says MUST HAVE; backend+UI absent. Recommended: later —
  demo USDT-only with an explicit NIM-disabled token option in the
  selector (server already 409s `NIM` cleanly). Building NIM now
  roughly doubles P1 (custodial wallet UI + repurposed Phase-8
  verification screens).
- **D4 — Admin escrow UI in demo scope?** Options: yes (P3 builds
  `AdminEscrows` + resolve) / no (admin resolves via direct API;
  record the skip). Recommended: no for the demo (disputes are
  owner-driven; admin API already works), yes before any public
  judging where a live dispute might need ruling.
- **D5 — mark-delivered placement.** Options: (a) per-claim rows
  on `SellDetail` (recommended: adjacent to demand,Room to grow
  the provider claim view later); (b) new provider claim page
  `/sell/claim/:claimId` (cleaner long-term, more files); (c) the
  existing `Sell.tsx` list inline (cramped, no room for payout
  form errors). 
- **D6 — Deprecated UI removal mode.** Options: (a) delete
  writers per §5 gates (recommended: no dead code, DB evidence
  supports it); (b) hide behind banner (keeps bundle + confusion).
- **D7 — Chain-id + USDT-address sourcing.** Backend serves
  neither (findings G1/G2 §9). Options: (a) Vite build-time vars
  (recommended for demo: follows existing `VITE_API_BASE_URL`
  pattern; Amoy-only values documented in the plan);
  (b) hardcoded constants (worst — repeats the never-hardcode
  violation); (c) owner-scoped micro-backend-addition to serve
  them in `escrow-intent` (cleanest long-term, but backend work —
  explicitly out of this track).

## 9. Findings (no backend change proposed)

- **G1 — USDT token address unserved.** `USDT_TOKEN_ADDRESS` is
  parsed in `env.ts:46` but read nowhere in `apps/api/src`; no
  endpoint returns it, yet the UI must call `approve()` on it.
  Owner must pick D7.
- **G2 — Expected chain id unserved.** No `ESCROW_EXPECTED_CHAIN_ID`
  (already flagged in the 14d-3a addendum); UI must assume Amoy
  80002 until served. Same D7 decision covers it.
- **G3 — Frontend type lag (divergence, backend wins).**
  `ClaimView` lacks served fields `provider_contact_note` /
  `deposit_submitted_at`; buckets/badge lack all escrow statuses
  (escrow claims are currently invisible in `/claims`). Fixed
  inside P1 as specified above.

## 10. Non-goals

Multi-token beyond USDT (+NIM placeholder only); WalletConnect /
Coinbase / embedded signers; mainnet or any non-Amoy chain; gas
sponsorship/abstraction; dispute evidence upload or chat; refund
destination editing; auto-release UI (backend gap, separate scope);
batch/multi-claim flows; analytics, notifications, PWA/offline;
i18n beyond existing copy; backend or contract changes of any kind.

## 11. Risks

- **EVM provider absent in Nimiq Pay** (likelihood high until
  probed, impact high — USDT flow unusable in-app). Mitigation:
  probe first (D2-a); design the browser-handoff copy in P1
  regardless so both outcomes are shippable.
- **Free-tier RPC limits under demo load** (medium/high — already
  observed: Tenderly refuses sends, Alchemy caps scans; 14e-2e
  split depends on both staying permissive). Mitigation: keep the
  15 s/6 s backoff budgets; confirm both endpoints the demo
  morning; paid-tier decision stays with owner.
- **Amoy fee spikes** (medium — 500 gwei observed; backend pays
  release, users pay approve/deposit). Mitigation: surface
  estimation failures plainly; fund demo wallets ~0.1 POL.
- **Fund lock on partial shipment** (low — P1+P2 ship as one
  increment, §6). Mitigation: sequencing rule + hold/verify
  windows documented in UI copy.
- **Scope creep into NIM** (medium). Mitigation: D3 recorded;
  token selector ships USDT-enabled/NIM-disabled.
- **Wrong-chain / wrong-spender user error** (medium).
  Mitigation: exact-amount approve copy, chain-switch gate before
  every send, spender/contract/gsin display from server
  instruction (never typed).
