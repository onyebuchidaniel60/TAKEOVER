# AGENTS.md — TAKEOVER

## Project

TAKEOVER is a Nimiq Pay Mini App: a last-minute marketplace for released/scarce capacity. Providers publish available slots; buyers claim them and fund a dual-token escrow (NIM through Nimiq Pay, or USDT on Polygon); the backend verifies the on-chain deposit before the claim moves to escrow_funded.

TAKEOVER is a consumer marketplace. Nimiq is payment/wallet infrastructure, not the product identity.

## Source of truth

Read these files before changing code:

1. `PROJECT_SPEC.md` — product, scope, business rules, acceptance criteria.
2. `ARCHITECTURE.md` — technical architecture, state machines, security model.
3. `IMPLEMENTATION_PLAN.md` — current phased implementation sequence.
4. `AI_HANDOFF.md` — current project state and exact next task.

These documents are authoritative.

## Design skills

For any UI, styling, animation, or visual-polish work in apps/web, consult the design skills under .opencode/skills/. Load them via the skill tool before making design decisions. The emil-design-eng skill is the primary reference; the others (apple-design, find-animation-opportunities, improve-animations, review-animations) support specific polish tasks.

## Fixed architecture

Frontend:
- React
- TypeScript
- Vite
- Tailwind CSS
- `@nimiq/mini-app-sdk`
- Zustand only where shared client state genuinely requires it

Backend:
- Node.js
- TypeScript
- Fastify
- Zod

Database:
- PostgreSQL
- Drizzle ORM
- Supabase hosting for initial deployment

Deployment:
- Vercel frontend
- Railway backend
- Supabase database

Payment:
- USDT (ERC-20 on Polygon) escrowed by a non-custodial smart contract; NIM (native Nimiq) as the env-gated listing fee paid by sellers at publish time (verified on-chain, receive-only wallet, no custody)
- Nimiq Pay `sendBasicTransactionWithData()` for NIM transfers (listing-fee payment)
- Server-side Nimiq read/RPC verification for NIM fee payments
- USDT deposits verified via Polygon escrow-contract events
- Non-custodial smart contract for USDT escrow; the NIM fee wallet only receives (never signs, no private key server-side)

AI:
- None in MVP.

## Non-negotiable business rules

- Only provider/authorized supply can be listed. Arbitrary customer reservation transfer is future scope.
- Published commercial fields are immutable in MVP.
- Claims are created inside a database transaction with locking.
- A slot's final available unit cannot be claimed twice.
- A buyer cannot maintain multiple active claims for the same slot.
- A claim hold expires when its hold deadline passes if no transaction has been submitted.
- Submitted payment enters verification; it is not automatically successful.
- A client can never set a payment/claim status directly.
- Payment is successful only after backend verification of sender, recipient, exact amount, expected transaction data, transaction existence, confirmation policy, and replay protection.
- The same blockchain transaction cannot settle two claims.
- Provider cancellation is unavailable after a claim has a verified payment.
- USDT escrow is non-custodial: funds are held by a Polygon smart contract, never by TAKEOVER.
- NIM is the env-gated listing fee, not escrow: the fee wallet only receives; it never signs, holds, or forwards funds, and no private key exists server-side.
- Funds release to the provider only on confirmed delivery or on expiry of the undisputed dispute window.
- Funds refund to the buyer only on delivery timeout or admin resolution of a dispute.
- Every fund movement writes an audit event in the same DB transaction as the state change (NIM) or mirrors the on-chain event (USDT).
- The Polygon contract signer key must never be logged, printed, returned in any API response, or committed. (There is no NIM wallet key to protect: the fee wallet never signs.)
- (Retired 14f-r: the NIM custodial escrow wallet, its private key, and the escrow:wallet ledger invariant no longer exist. Do not reintroduce them.)
- Do not expose private wallet/session/authentication information.

## Product scope rules

MVP does not include:
- fiat payments
- AI matching
- calendar integrations
- ratings/reputation
- native mobile applications
- broad CRM features
- consumer reservation transfer
- advanced analytics
- complex notifications

Do not add features because they sound impressive.

## Coding rules

1. Follow the specification exactly.
2. Do not invent requirements.
3. Do not change architecture without explicit approval.
4. Do not replace the chosen stack.
5. Do not add a dependency when a current dependency already solves the problem.
6. Do not modify unrelated files.
7. Prefer simple, readable code over clever abstractions.
8. Keep business logic out of UI components.
9. Validate all external input at API boundaries.
10. Keep the server authoritative.
11. Use DB constraints as a second line of defense for invariants.
12. Use transactions for inventory/claim/payment state changes.
13. Make sensitive mutations idempotent where specified.
14. Do not trust browser state for ownership, price, recipient, amount, role, or payment status.
15. Never log secrets, signatures, cookies, auth headers, or private credentials.
16. Never hardcode secrets.
17. Do not fetch arbitrary URLs from the server.
18. Do not introduce AI into payment/authorization/state logic.
19. Never use a UI-only guard as the security boundary.
20. Never hide errors silently.

## Nimiq rules

- Use the official Mini App SDK API available in the pinned project dependency.
- Wallet operations originate from the Nimiq Pay provider.
- Never store a private key.
- Never ask the user to paste a private key or seed phrase.
- Verify user signatures server-side for authentication.
- Treat transaction hashes supplied by the client as untrusted references until verified independently.
- Follow current official Nimiq API semantics for transaction verification.

## Polygon and USDT rules

- Use window.ethereum with chainId '0x89' (Polygon mainnet). Polygon Amoy testnet ('0x13882') is NOT supported by Nimiq Pay — see the chain target note after ARCHITECTURE.md §22; testnet was development-only.
- The escrow contract address is read from USDT_ESCROW_CONTRACT_ADDRESS env; never hardcoded.
- Contract events are verified against the configured contract address only. Never trust client-supplied escrow IDs or contract addresses.
- USDT amount is always the exact base units (6 decimals on Polygon). Never float.
- Approval is exact-amount; never infinite approval.
- Smart contract changes require a new deployment + a new audit. The deployed contract is immutable.

## Security rules

Always consider:
- authentication replay
- session theft
- IDOR
- privilege escalation
- malformed input
- injection
- XSS
- CSRF
- rate abuse
- transaction replay
- amount manipulation
- recipient manipulation
- sender spoofing
- transaction-data spoofing
- concurrent claim races
- secret leakage
- admin-route exposure

When touching payment or claim logic, add or update tests for the security invariant being changed.

## Testing rules

After each meaningful implementation:

1. Run targeted unit tests.
2. Run integration tests when API/DB behavior changes.
3. Run lint.
4. Run build.
5. Run relevant E2E flow for UI/payment changes.
6. Inspect the actual diff.

Never claim something works without evidence.

## Git rules

Use small meaningful commits.

Examples:
- `feat: add wallet authentication`
- `feat: add marketplace discovery`
- `fix: prevent duplicate claims`
- `test: verify payment replay protection`
- `security: harden authorization`

Do not create vague giant commits.

## Phase rules

The current phase is defined in `AI_HANDOFF.md`.

Implement **only the assigned phase/task**.

Do not start the next phase automatically.

At the end:
- report files changed;
- report tests actually run and results;
- report known issues;
- update `AI_HANDOFF.md` if instructed by the phase;
- create the Git checkpoint;
- STOP.

## Ambiguity rule

If ambiguity affects product behavior, business rules, security, state transitions, data ownership, or architecture:

- stop;
- explain the ambiguity;
- identify the exact affected requirement;
- do not silently invent behavior.

If ambiguity is a harmless implementation detail that does not affect the specified behavior, choose the simplest implementation and label it:

`IMPLEMENTATION DETAIL — AGENT MAY DECIDE`

## Failure rule

When something fails:
- preserve the reproducible error;
- diagnose before changing architecture;
- fix the smallest responsible layer;
- add a regression test when appropriate;
- re-run verification;
- report the result.

Do not work around a failure by disabling validation, reducing security, or faking external responses in production code.

## Documentation rule

When a phase changes a contract, update the appropriate documentation. Do not silently change API behavior without documenting it.

## Scope-control rule

The agent is an implementation executor, not the product owner.

Do not:
- redesign the product;
- introduce new feature categories;
- switch frameworks;
- replace PostgreSQL;
- add AI;
- change the approved escrow model;
- add a new payment provider;
- redesign core state machines;
- invent new user roles;
- change MVP scope.

Request approval before any such change.

## Stop condition

A completed task is not permission to continue. STOP after the assigned phase is implemented, tested, reviewed, and committed.
