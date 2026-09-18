# TAKEOVER — Architecture & Security Design

Status: Fixed pre-implementation architecture
Version: 1.0
Date: 2026-09-11

## 1. Architecture decision

TAKEOVER uses a deliberately boring architecture:

- Frontend: React + TypeScript + Vite
- Styling: Tailwind CSS
- State: Zustand only for client state that must be shared; server state remains API-driven
- Mini App integration: `@nimiq/mini-app-sdk`
- Backend: Node.js + TypeScript + Fastify
- Validation: Zod at API boundaries
- Database: PostgreSQL
- Database access: Drizzle ORM
- Authentication: wallet-signature challenge + secure server session
- Payments: USDT (ERC-20 on Polygon) escrowed by a non-custodial smart
  contract; NIM (native Nimiq) as the env-gated listing fee paid by sellers
  at publish time (verified on-chain, receive-only wallet, no custody).
- Blockchain verification: Nimiq JSON-RPC/read API + Polygon contract-event verification, from server
- File/media storage: none for MVP; image URLs only
- Background jobs: none required for core correctness; expired records are resolved lazily plus optional periodic maintenance job
- Notifications: in-app state only in MVP
- AI: none in MVP
- Search: PostgreSQL indexed filtering; no Elasticsearch
- Cache: no application cache in MVP
- Logging: structured Fastify logs
- Error monitoring: Sentry or equivalent only if approved during implementation; not required for local correctness
- Frontend hosting: Vercel or equivalent static/SPA HTTPS host
- Backend hosting: Railway or equivalent Node host
- Database hosting: Supabase Postgres

This architecture is fixed. The coding agent must not replace the stack or add infrastructure without explicit approval.

## 2. High-level architecture

```text
Buyer
  |
  v
Nimiq Pay Mini App
  |
  +--> NIM listing fee --> Nimiq chain --> TAKEOVER fee wallet (receive-only)
  |                                                |
  |                                                | read-back (verification)
  |                                                v
  |                                          Fastify backend
  |                                                ^
  |                                                | events
  |                                                |
  +--> USDT --> Polygon chain --> Escrow smart contract
```

(F3 cleanup, 2026-09-17: the NIM custodial escrow wallet was retired in
14f-r and replaced in 14g-1 by the receive-only listing-fee wallet. No
backend key, no signing, no ledger, no custody.)

## 3. Architectural principles

1. Server is authoritative for user identity, ownership, listing state, claims, and payment state.
2. Browser state is advisory only.
3. Database transactions protect scarce inventory.
4. Every security-sensitive API checks authorization server-side.
5. Payment is not considered successful until server-side blockchain verification succeeds.
6. Buyer funds are held in escrow until a release condition is met. USDT is escrowed by a non-custodial smart contract on Polygon; the escrow contract is the authoritative source of truth. (F3 cleanup, 2026-09-17: the NIM custodial escrow wallet was retired in 14f-r. NIM is now only the publish-time listing fee — a receive-only wallet, verified on-chain, never custody.)
7. No LLM controls financial or ownership decisions.
8. Every state transition is explicit. State transitions are performed through service-layer functions rather than arbitrary controller updates.
9. Every irreversible action is narrow and audited.
10. Do not solve future-scale problems before the MVP needs them.

## 4. Authentication architecture

### 4.1 Identity

The canonical user identity is a verified Nimiq wallet address.

The Mini App obtains wallet access through the injected Nimiq provider. The app requests a challenge from the server, signs that challenge using the Nimiq provider, and submits the signature for verification.

The optional Nimiq Pay device identifier may be used as supplementary telemetry/session hardening where supported, but it is not the primary identity.

### 4.2 Session

After successful signature verification, backend creates a random, opaque session identifier. Store the session hash server-side; return the raw session in an `HttpOnly` cookie — `SameSite=Lax` without `Secure` in dev, `SameSite=None` with `Secure=true` in production (locked Vercel → Railway cross-origin topology) — when browser embedding permits it.

Session expiration: 7 days fixed from issuance (the `expires_at` set at session creation; authenticated use refreshes `last_seen_at` only).

Logout destroys/revokes the session server-side.

#### Bearer fallback (Phase 14c, owner approved)

Some hosts drop the third-party session cookie (confirmed: Nimiq Pay Android WebView third-party-cookie policy, Phase 14b). For those hosts, `POST /auth/verify` additionally returns the raw session token (`sessionToken`) in the success body, and the server accepts `Authorization: Bearer <sessionId>.<secret>` as an alternate presentation of the SAME session row (same constant-time secret comparison, same TTL, same revocation; cookie preferred when it parses). The token is never logged and never returned by any other endpoint. The frontend keeps it in `sessionStorage` only (in-memory fallback when `sessionStorage` is unavailable; never `localStorage`, never a cookie, never `window`/global) and clears it on logout; server-side logout revokes the single session, killing both presentations together. Precedence rule: when a session cookie IS present (even alongside a Bearer token), the cookie path — including the §16 CSRF guard — applies unchanged. The `HttpOnly`-loss trade-off (token in JS-accessible storage) is accepted and bounded by the 7-day TTL, revoke-on-logout, and sessionStorage-only scope; see SECURITY_REVIEW.md.

### 4.3 Challenge

Challenge record:
- nonce
- wallet address
- created_at
- expires_at (5 minutes)
- consumed_at

A challenge is single-use.

### 4.4 Important implementation detail

**IMPLEMENTATION DETAIL — AGENT MAY DECIDE:** exact byte encoding/message envelope required by the installed `@nimiq/mini-app-sdk` `sign()` API, provided the resulting server verification preserves the rules above and follows the current official SDK API.

### 4.5 Signature verification proof (Phase 3 completion)

The exact signed-message envelope is:

`sign( sha256( '\x16Nimiq Signed Message:\n' + message.length + message ) )`

where `message.length` is the stringified decimal length and `message` is the
UTF-8 challenge string. The 23-byte prefix `'\x16Nimiq Signed Message:\n'`
is pinned byte-for-byte in tests.

Production verification (`apps/api/src/auth/nimiq-verify.ts`) uses only
`tweetnacl` (Ed25519) + `@noble/hashes` (Blake2b for address derivation) +
Node `crypto` (SHA-256) and does NOT depend on `@nimiq/core` at runtime.

`@nimiq/core` (^2.21.0, root devDependency) is used exclusively as a test
oracle in `apps/api/test/nimiq-oracle.test.ts`: keys, addresses, hashes, and
signatures are produced by the official library and only consumed/verified by
production code (cross-checked in both directions). It is never imported by
production code.

Reverted in 14f-r (2026-09-17): the 14f-1 dual-use revision was for NIM
escrow-wallet signing, which has been retired. `@nimiq/core` is once again
a root devDependency used exclusively as the test oracle.

Citation (both confirmed 2026-09-11): official Hub `signMessage` docs —
https://nimiq.github.io/api-reference/sign-message ("Prefixing and Hashing"
defines the envelope above; "Verification" points at the core library) —
plus the installed oracle implementation:
`node_modules/@nimiq/core/nodejs/main-wasm/index.js` (`Signature.create` /
`PublicKey.verify` / `Hash.computeSha256` / `KeyPair.generate`) and
`node_modules/@nimiq/core/lib/node/index.js` (`BufferUtils.fromUtf8`).

## 5. Authorization model

Authorization is resource based.

- Public: published active slot summary/detail.
- Buyer-owned: own claims, own escrows.
- Provider-owned: own slots, claims attached to own slots.
- Admin-only: reports, audit events, moderation controls, user disable state.

Every API accepting a user-controlled ID must load the resource and compare the server-authenticated owner/role before mutation.

## 6. Payment architecture

### MVP payment model

USDT on Polygon is the sole escrow rail. All new payments route through
the non-custodial escrow contract; the buyer pays USDT at escrow-intent
time. (Retired in 14f-r, 2026-09-17: the NIM custodial escrow rail —
Path B below and the D5 sender-bound note — was removed before
implementation completed. The design text is retained for reference;
only the USDT path is implemented.)

Path A — USDT on Polygon:
  - Buyer approves and deposits into the TAKEOVER escrow contract.
  - Contract emits Deposited; backend verifies and moves claim to
    escrow_funded.
  - Provider marks delivered; backend records and starts dispute
    window.
  - Buyer confirms -> backend calls contract release(), contract sends
    USDT to provider.
  - Buyer disputes -> backend calls contract dispute(); admin resolves
    -> contract release() or refund().
  - Delivery timeout -> contract auto-refund (or backend calls
    refund()).

Path B — NIM:
  - Buyer sends NIM to the escrow wallet with the TAKEOVER data
    binding.
  - Backend verifies the deposit on-chain; claim moves to
    escrow_funded.
  - Provider marks delivered.
  - Buyer confirms -> backend signs and sends NIM from the escrow
    wallet to the provider.
  - Dispute -> admin resolves -> backend signs release or refund.
  - Delivery timeout -> backend signs refund to the buyer.

### NIM listing fee (Phase 14g-1)

Publishing a slot costs a pinned NIM listing fee when configured
(`LISTING_FEE_NIM`, decimal string, e.g. `"400"`; `TAKEOVER_FEE_WALLET_ADDRESS`
is the receive-only wallet). The seller pays via Nimiq Pay with the exact
binding `TAKEOVER:fee:v1:<slotId>`; the publish endpoint verifies the
transfer on-chain (sender = slot owner, recipient = fee wallet, exact Luna
amount via `nimToBaseUnits`, confirmations >= 3, replay-guarded by the
`listing_fee_tx_hash` UNIQUE column) before flipping draft → published.
When either var is unset, publishing behaves as before (no fee). A set
amount with a missing/malformed wallet fails closed (503). The fee wallet
only receives: no private key exists server-side, nothing ever signs from
it, no ledger is written, no custody of any kind. Users see "400 NIM" —
Luna never reaches the UI. Fee terms are served publicly by
`GET /api/v1/config`.

### Payment intent

Key management:
  - USDT path: server signer key for calling contract functions.
    KMS-protected in production; env secret for the competition
    build (documented gap).
  - NIM path (retired, see the note above): escrow wallet private key.
    KMS-protected in production; env secret for the competition build
    (documented gap).

Ledger invariant (retired NIM design, retained for reference):
  SUM(credits to 'escrow:wallet') minus SUM(debits from
  'escrow:wallet') across escrow_ledger must equal the on-chain NIM
  escrow wallet balance at all times.

Note: the previous Phase 8 note about direct buyer-to-provider
payment is superseded. All new payments route through escrow.

### Phase 14d-2 implementation note (2026-09-15)

USDT-only on-demand deposit verification. The buyer polls
`POST /claims/:claimId/verify-deposit`; each call reads the contract's
`Deposited` event for the escrow's `on_chain_escrow_id` and assesses it
against the escrow row (escrow id, exact base-unit amount).
No background worker exists: polling is the verification trigger, mirroring
the deprecated `verify-payment` pattern. NIM requested at escrow-intent
time was rejected with 409 `ESCROW_TOKEN_UNSUPPORTED` (superseded in
14f-1 — NIM intent is now supported, see the endpoint entry below). Env read: `POLYGON_RPC_URL` (event reads, fail-closed when unset),
`USDT_ESCROW_CONTRACT_ADDRESS` (event filter + deposit instruction, never
hardcoded), `ESCROW_DEPOSIT_VERIFICATION_SECONDS` (default 1800, pending →
`payment_review` on expiry, inventory stays reserved), and the new
`ESCROW_DELIVERY_WINDOW_SECONDS` (default 86400; `delivery_deadline` set on
funding, enforced later). The escrow row is created at intent time
(`created`, NULL funded fields) and moves to `funded` with
`deposit_tx_hash`/`funded_at`/`delivery_deadline` in the same transaction
as the claim's move to `escrow_funded`. `release()`/`refund()` remain
not-implemented (14d-3).

### Phase 14d-2 completion note (2026-09-15)

Deposit verification matches on `escrowId` and exact `amount` only; the
on-chain `buyer` is recorded by the contract for refund routing and is not
verified backend-side. The verification window is measured from
`claims.deposit_submitted_at`.

### Phase 14d-3a release note (2026-09-15)

Provider marks delivered with their EVM payout address (stored immutably on
the escrow row; later calls must match); the claim moves to `delivered` and
`dispute_window_ends` is set (`ESCROW_DISPUTE_WINDOW_SECONDS`, default
86400 — no dispute logic yet, just the deadline). Buyer confirmation
broadcasts the server-signed `release(escrowId, toProvider)` (signer key
from `ESCROW_SIGNER_PRIVATE_KEY`, lazily loaded, cross-checked against
`ESCROW_SIGNER_ADDRESS`, never logged/returned) and records
`release_tx_hash` while staying `delivered`; the rows flip to `released`
only after `ESCROW_RELEASE_CONFIRMATIONS` (default 3) Polygon confirmations
on the release transaction. Every step is idempotent with conditional
writes (re-submit returns pending, re-confirm after release is a no-op);
audits are `escrow.delivered`, `escrow.release_submitted`, and
`escrow.released`.

### Phase 14d-3b dispute/refund note (2026-09-16)

Dispute is buyer-initiated on-chain and backend-observed: the buyer calls the
contract's `dispute(escrowId)` from their own wallet (the server never
broadcasts it); `POST /claims/:claimId/dispute` returns the call instruction
until the `Disputed` event is visible, then flips claim and escrow to
`disputed` for admin resolution (release or refund, both server-signed with
the same signer as 14d-3a). Auto-refund is lazy — no worker exists: every
escrow read (`GET /escrow` buyer/provider views, `GET /admin/escrows`)
first runs the transition check, so a `funded` escrow past its
`delivery_deadline` broadcasts `refund()` and parks in `refunding`, and
`refunding`/`releasing` rows flip terminal once `ESCROW_REFUND_CONFIRMATIONS`
/ `ESCROW_RELEASE_CONFIRMATIONS` (both default 3) are met. Reads trigger
transitions; a funded escrow past deadline refunds on next read, never
spontaneously.

## 7. Slot/claim concurrency

The final unit of a slot is scarce inventory and must be protected with a database transaction.

Preferred operation:

```text
BEGIN
SELECT slot FOR UPDATE
validate slot is PUBLISHED and active
validate available_quantity > 0
validate buyer has no active claim
INSERT claim
UPDATE slot available_quantity = available_quantity - requested_quantity
COMMIT
```

The unique constraint and row lock are both required; application-level checks alone are insufficient.

### Phase 6 implementation note (2026-09-11)

Sold-out openings stay publicly visible: the read filter is status IN
('published', 'sold_out') plus starts_at > now(), for both the list and the
detail endpoints. The final unit flips a slot to 'sold_out' inside the same
claim transaction that decrements it to zero; lazy hold expiry flips
'sold_out' back to 'published' inside the same restoration transaction when
stock returns. Expiry runs on GET /slots/:slotId, POST /slots/:slotId/claims,
and GET /me/claims — no background workers. The 'expired' slot status is not
set by any Phase 6 path. Claim holds last CLAIM_HOLD_TTL_SECONDS (default
600s per FR-05); claim quantity is fixed at 1. Duplicate claims by the same
buyer are idempotent: POST returns the existing live claim (200), never a
second row — the partial unique index remains the DB-level backstop.

## 8. State machines

### Slot states

```text
DRAFT -> PUBLISHED -> SOLD_OUT
              |  \
              |   -> CANCELLED
              -> EXPIRED
```

A paid single-capacity listing is logically SOLD_OUT immediately after verified payment. Multi-capacity listings remain PUBLISHED until available quantity reaches zero.

DRAFT can be edited freely by its owner. Expired active holds return their reserved quantity exactly once; this transition is idempotent.

PUBLISHED commercial fields are immutable in MVP.

PUBLISHED -> CANCELLED is allowed only when there are no PAID claims.

PUBLISHED -> EXPIRED occurs when start_at has passed without a paid claim. Any quantity still reserved by an expired unpaid hold must be released exactly once as part of hold-expiry resolution.

### Claim states

```text
active_hold -> escrow_funded
               |
               +-> refunded                     (delivery timeout, lazy auto-refund)
               |
               v
            delivered
               |
               +-> released                     (buyer confirm-receipt path)
               +-> disputed -> released         (admin resolve → release)
                           \-> refunded         (admin resolve → refund)
active_hold -> expired
active_hold -> cancelled
```

Remove "paid" from the claim_status enum. Terminal states are released, refunded, expired, cancelled.

### Deposit submission (Phase 14d-1)

```text
active_hold ──(no deposit reference in window)──> expired
     │
     └──(deposit reference recorded)──> deposit_submitted
                                              │
                          ┌───────────────────┼───────────────────┐
                          │                   │                   │
                    (verified)          (window expires)     (foreign/never lands)
                          ▼                   ▼                   ▼
                    escrow_funded       payment_review       payment_review
                          │
                           ▼
                     escrow_funded → delivered → released / disputed / refunded
                                     └→ refunded on delivery timeout (lazy auto-refund)
```

The deposit reference is recorded via escrow-submission; inventory stays
reserved in `deposit_submitted`. The verification window is
`ESCROW_DEPOSIT_VERIFICATION_SECONDS` (default 1800) from
`deposit_submitted` entry; on expiry the claim ages to the existing
`payment_review` surface (no new terminal state, inventory not released).
The escrow row itself moves `created → funded` on verified deposit.

### Legacy payment_intents states (deprecated — historical rows only)

```text
CREATED -> SUBMITTED -> VERIFIED
                    \-> REJECTED
                    \-> REVIEW
```

The same transaction cannot verify two successful payment intents. The current escrow flow is represented by the claim state machine above plus the `escrow_status` values (`created`, `funded`, `delivered`, `disputed`, `released`, `refunded`, plus the escrow-internal transitional states `refunding` and `releasing` used while a refund/release broadcast awaits its confirmation policy).

## 9. Database model

Reconciled to the implemented Phase 2 schema on 2026-09-11 (follow-up): the Phase 2
schema is the source of truth. The migration SQL under `db/migrations/` is authoritative
for DDL; this section describes it.

The seed script (`db/seed.ts`) and its fixture data (`NQ00 SEED*` wallets,
fixed `11111111-…`/`22222222-…` IDs) are development-only: `db:seed` refuses
`NODE_ENV=production`, and production databases must not contain `NQ00 SEED*`
rows. Fixture payouts deliberately fail address canonicalization, so any
leaked seed row breaks payment-intent creation for claims on it (Phase 14c
round 2); the one-time cleanup lives in `docs/phase-14c-seed-cleanup.sql`.

### users

- id UUID PK
- wallet_address TEXT NOT NULL UNIQUE
- role ENUM(user_role: buyer, provider, admin) NOT NULL DEFAULT buyer (server-controlled)
- status ENUM(user_status: active, disabled) NOT NULL DEFAULT active
- disabled_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ NOT NULL
- updated_at TIMESTAMPTZ NOT NULL

Publicly expose only safe profile fields.

### sessions

- id UUID PK
- user_id UUID FK users.id
- token_hash TEXT NOT NULL UNIQUE
- expires_at TIMESTAMPTZ NOT NULL
- created_at TIMESTAMPTZ NOT NULL
- last_seen_at TIMESTAMPTZ NOT NULL
- revoked_at TIMESTAMPTZ NULL

### auth_challenges

- id UUID PK
- wallet_address TEXT NOT NULL
- nonce TEXT NOT NULL UNIQUE
- expires_at TIMESTAMPTZ NOT NULL
- consumed_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ NOT NULL

### provider_profiles

- id UUID PK
- user_id UUID FK users.id UNIQUE NOT NULL
- display_name TEXT NOT NULL
- verified BOOLEAN NOT NULL DEFAULT false
- created_at TIMESTAMPTZ NOT NULL
- updated_at TIMESTAMPTZ NOT NULL

### slots

- id UUID PK
- provider_id UUID FK users.id
- title TEXT NOT NULL
- description TEXT NULL
- provider_contact_note TEXT NULL (Phase 14d-4: one-way provider contact
  note; API-validated 1–500 chars, no URLs; buyer-visible only past the
  escrow gate, never public)
- category TEXT NULL
- location_label TEXT NULL
- starts_at TIMESTAMPTZ NOT NULL
- ends_at TIMESTAMPTZ NULL
- price_usdt BIGINT NOT NULL (integer USDT base units, 6 decimals, no floats)
- total_quantity INTEGER NOT NULL
- available_quantity INTEGER NOT NULL
- payout_wallet TEXT NOT NULL
- status ENUM(slot_status: draft, published, sold_out, cancelled, expired) NOT NULL DEFAULT draft
- published_at TIMESTAMPTZ NULL
- cancelled_at TIMESTAMPTZ NULL
- expired_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ NOT NULL
- updated_at TIMESTAMPTZ NOT NULL

Indexes:
- status, starts_at

Constraints:
- total_quantity > 0
- available_quantity >= 0
- available_quantity <= total_quantity
- price_usdt > 0

### claims

- id UUID PK
- slot_id UUID FK slots.id
- buyer_id UUID FK users.id
- quantity INTEGER NOT NULL DEFAULT 1
- status ENUM(claim_status: active_hold, expired, deposit_submitted, payment_pending, paid, payment_review, cancelled, escrow_funded, delivered, disputed, released, refunded) NOT NULL DEFAULT active_hold
  -- payment_pending and paid are legacy values retained for historical rows;
  -- the live escrow flow uses active_hold -> deposit_submitted -> escrow_funded -> delivered -> released|refunded|disputed.
- hold_expires_at TIMESTAMPTZ NOT NULL
- claimed_at TIMESTAMPTZ NOT NULL
- deposit_submitted_at TIMESTAMPTZ NULL
- updated_at TIMESTAMPTZ NOT NULL

Constraints:
- quantity > 0

Unique/partial-index requirement:
- one live (active_hold, payment_pending, payment_review) claim per buyer+slot.
  expired, cancelled, released, and refunded rows may repeat, so a buyer can accumulate multiple
  released claims on a multi-quantity slot while holding only one live claim at a time.

### payment_intents

- id UUID PK
- claim_id UUID FK claims.id UNIQUE
- expected_amount_nim BIGINT NOT NULL (integer NIM base units, no floats)
- expected_recipient TEXT NOT NULL
- expected_sender TEXT NOT NULL
- expected_data TEXT NOT NULL
- status ENUM(payment_status: created, submitted, verified, rejected, review) NOT NULL DEFAULT created
- tx_hash TEXT NULL UNIQUE (unique when present: the same on-chain transaction can never settle two claims)
- submitted_at TIMESTAMPTZ NULL
- verified_at TIMESTAMPTZ NULL
- created_at TIMESTAMPTZ NOT NULL
- updated_at TIMESTAMPTZ NOT NULL

Deprecated: the payment_intents table is kept for historical rows only. All new payments use the escrows table.

### escrows

- id UUID PK
- claim_id UUID FK claims.id UNIQUE
- buyer_id UUID FK users.id
- provider_id UUID FK users.id
- payment_token ENUM('NIM','USDT_POLYGON') NOT NULL
- amount_base_units BIGINT NOT NULL
- status ENUM(escrow_status: 'created','funded','delivered','disputed','released','refunded','refunding','releasing') NOT NULL
  -- 'refunding'/'releasing' are escrow-internal transitional states (broadcast in flight); the claim row never carries them.
- deposit_tx_hash TEXT UNIQUE NOT NULL   -- on-chain deposit tx: NIM transfer hash, or Polygon tx hash containing the escrow contract's Deposited event
- release_tx_hash TEXT UNIQUE NULL
- refund_tx_hash TEXT UNIQUE NULL
- contract_address TEXT NULL            -- USDT only
- on_chain_escrow_id TEXT NULL          -- USDT only
- provider_payout_address TEXT NULL     -- USDT only: EVM payout address supplied at delivery time, stored immutably
- funded_at TIMESTAMPTZ NOT NULL
- delivery_deadline TIMESTAMPTZ NOT NULL
- delivered_at TIMESTAMPTZ NULL
- dispute_window_ends TIMESTAMPTZ NULL
- disputed_at TIMESTAMPTZ NULL
- resolved_at TIMESTAMPTZ NULL
- resolved_by_user_id UUID FK users.id NULL
- resolution_notes TEXT NULL
- created_at TIMESTAMPTZ NOT NULL
- updated_at TIMESTAMPTZ NOT NULL

### escrow_ledger (retired NIM design — table retained, currently unused)

No backend code writes to this table (the NIM custodial rail that used
it was retired in 14f-r). The table is retained because dropping it
would need a migration that is not justified for a demo. Field
reference (schema is authoritative):

- id UUID PK
- escrow_id UUID FK escrows.id
- entry_type ENUM('deposit','release','refund') NOT NULL
- debit_account TEXT NOT NULL
- credit_account TEXT NOT NULL
- amount_base_units BIGINT NOT NULL
- tx_hash TEXT NOT NULL
- created_at TIMESTAMPTZ NOT NULL

### reports

- id UUID PK
- reporter_id UUID FK users.id
- slot_id UUID FK slots.id NULL
- target_user_id UUID FK users.id NULL
- reason TEXT NOT NULL
- details TEXT NULL
- status ENUM(report_status: open, reviewed, dismissed) NOT NULL DEFAULT open
- created_at TIMESTAMPTZ NOT NULL
- reviewed_at TIMESTAMPTZ NULL
- resolved_by_user_id UUID FK users.id NULL
- resolution_notes TEXT NULL

### audit_events

- id UUID PK
- actor_user_id UUID FK users.id NULL
- event_type TEXT NOT NULL
- entity_type TEXT NOT NULL
- entity_id TEXT NOT NULL
- request_id TEXT NULL
- metadata JSONB NULL
- created_at TIMESTAMPTZ NOT NULL

Audit metadata must never contain secrets, authentication signatures, session cookies, or full sensitive request bodies.

## 10. Relationships

```text
users 1---1 provider_profiles
users 1---* slots
users 1---* claims (buyer)
slots 1---* claims
claims 1---1 payment_intents
claims 1---1 escrows
escrows 1---* escrow_ledger
users 1---* escrows (buyer + provider)
users 1---* reports
users 1---* audit_events
```

## 11. Public/private data

Public:
- active slot title/category/description
- venue name/address
- start/end times
- capacity remaining
- price
- provider public display name/verification badge

Buyer-private:
- own claim IDs/statuses
- own wallet address where necessary
- payment intent details
- submitted transaction hash
- own escrow details, deposit tx hash, and dispute status

Provider-private:
- own listing management fields
- buyer identifiers only to the minimum required to fulfill the claim
- claim/payment statuses for own slots
- escrow state for own slots.

Admin-only:
- moderation reports
- audit details
- disabled-user status
- internal failure messages

Never public:
- session hashes/cookies
- auth challenges
- internal database IDs when unnecessary
- admin role assignment metadata
- raw signatures
- server environment variables
- internal RPC credentials

## 12. API architecture

Base path: `/api/v1`

All JSON responses use a stable envelope.

Success:

```json
{
  "data": {},
  "requestId": "..."
}
```

Error:

```json
{
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "This slot is no longer available."
  },
  "requestId": "..."
}
```

Messages are safe for clients; stack traces remain server-side.

## 13. API endpoint catalogue

### POST /api/v1/auth/challenge

Auth: none.

Request:

```json
{ "walletAddress": "NQ..." }
```

Server validates address format and returns a challenge message and challenge ID. Rate limited.

### POST /api/v1/auth/verify

Auth: none.

Request:

```json
{
  "challengeId": "uuid",
  "walletAddress": "NQ...",
  "signature": "..."
}
```

Server verifies single-use challenge, wallet ownership/signature, and disabled status. Creates session.

### POST /api/v1/auth/logout

Auth: session.

Revokes current session.

### GET /api/v1/me

Auth: session.

Returns safe user profile and role, plus `providerProfile:
{ displayName: string } | null` (null until a display name is set).

### GET /api/v1/slots

Auth: optional.

Query:
- category
- from
- to
- city
- lat
- lng
- radiusKm
- sort
- page
- pageSize

Rules: only public active slots.

Rate limit: public read limit.

### GET /api/v1/slots/:slotId

Auth: optional.

Returns public slot detail, including `providerDisplay` (profile
display_name when set, else the truncated provider wallet — public-safe in
both forms). The owner projection carries the same field plus
`payout_wallet`.

### POST /api/v1/slots

Auth: session.

Creates DRAFT or PUBLISHED slot based on request action.

Idempotency-Key recommended for create.

### PATCH /api/v1/slots/:slotId

Auth: session + owner.

Only editable DRAFT slots. Once published, commercial fields are immutable.

### PATCH /api/v1/me/slots/:slotId/contact-note (Phase 14d-4)

Auth: session + slot owner (non-owner or missing slot → 404 `NOT_FOUND`,
never 403; anonymous → 401).

Body (strict): `{ provider_contact_note: string | null }` — trimmed,
1–500 chars after trim; `null` clears the note. Rejects any value
containing `://` (any scheme) or `www.` (case-insensitive) → 400
`INVALID_INPUT`. Allowed on any owned status (the write gate is open; the
restriction lives on the buyer read gate). Same response shape as the
existing PATCH (`{ slot }` owner projection, which carries the note).
Writes `slot.contact_note_updated` in the same transaction (metadata:
`slotId`, `hadNote`, `noteLength` — never the note text); same-value
re-sets are 200 no-ops with no audit row.

Shares the per-IP owner-mutation budget with patch/publish/cancel.

### POST /api/v1/slots/:slotId/publish

Auth: session + owner.

Publishes valid draft.

Body (strict, Phase 14g-1): `{}` or `{ transactionHash: string }`. When the
NIM listing fee is configured (`LISTING_FEE_NIM` + `TAKEOVER_FEE_WALLET_ADDRESS`
both set), the hash is required and verified on-chain before the flip
(sender = owner, recipient = fee wallet, exact Luna amount, data
`TAKEOVER:fee:v1:<slotId>`, >= 3 confirmations): missing/malformed → 400
`PAYMENT_INVALID_TX`; unknown hash → 409 `PAYMENT_NOT_FOUND`;
under-confirmed → 409 `PAYMENT_NOT_CONFIRMED`; field mismatches → the
matching 409 `PAYMENT_*_MISMATCH`; reused hash → 409 `PAYMENT_REPLAY`.
Half-configured fee → 503 `INTERNAL_ERROR` (fail-closed). On success the
slot flips draft → published with `listing_fee_tx_hash`/`listing_fee_paid_at`
recorded and a `slot.published` audit (carries the fee hash). Re-POST of the
same hash on the same published slot is an idempotent 200. When no fee is
configured the body is ignored and behavior is unchanged.

### GET /api/v1/config (Phase 14g-1)

Auth: none (public).

Returns the NIM listing-fee terms: `{ listingFee: { required, amountNim,
walletAddress, misconfigured? } }` — `amountNim` is a decimal NIM string
(never Luna); `required` is true only when both fee vars are set;
`misconfigured: true` marks a set amount with a missing/malformed wallet
(publish fails closed then). `Cache-Control: no-store`.

### POST /api/v1/slots/:slotId/cancel

Auth: session + owner.

Cancels an unpaid active listing.

### GET /api/v1/me/slots

Auth: session.

Owner-only listing history.

### GET /api/v1/me/slots/:slotId/claims

Auth: session + slot owner (non-owner sees 404, never 403).

Returns every claim on the owned slot (newest first) with truncated buyer
identifiers (`buyerDisplay`, first 4 + '…' + last 4) plus exact per-status
`counts`. Never exposes full buyer wallets, tx hashes, or payment-intent
fields.

### PATCH /api/v1/me/provider-profile

Auth: session.

Upserts the caller's provider display name (`display_name`, trimmed 2–60
chars, no links). Only `display_name` is editable; `verified` stays
server/admin-controlled.

### POST /api/v1/slots/:slotId/claims

Auth: session.

Request:

```json
{ "quantity": 1 }
```

Must use a transaction and row lock.

Idempotency-Key required.

### GET /api/v1/claims/:claimId

Auth: session + buyer or provider owner of slot, with field-level response restrictions.

Phase 14d-4: the buyer view carries `provider_contact_note: string | null`
— the slot's note when the claim's escrow is `funded`, `delivered`,
`disputed`, `releasing`, or `released`, else null (no escrow, or escrow
`created`/`refunding`/`refunded`, all read null). The provider owner is not
served on this endpoint (404); the provider reads the note from their slot
owner projection instead.

### POST /api/v1/claims/:claimId/payment-intent (DEPRECATED)

Deprecated: use `POST /api/v1/claims/:claimId/escrow-intent`. Kept for historical rows only.

Auth: session + buyer owner.

Creates or returns the existing payment intent. Must not mint multiple intents for one claim.

Idempotency-Key required.

### POST /api/v1/claims/:claimId/payment-submission (DEPRECATED)

Deprecated: use `POST /api/v1/claims/:claimId/escrow-submission`. Kept for historical rows only.

Auth: session + buyer owner.

Request:

```json
{ "transactionHash": "..." }
```

Server validates format and records submission, then attempts verification.

Idempotency-Key required.

### POST /api/v1/claims/:claimId/verify-payment (DEPRECATED)

Deprecated: use `POST /api/v1/claims/:claimId/verify-deposit`. Kept for historical rows only.

Auth: session + buyer owner, and safe to call repeatedly.

Server re-queries Nimiq state and attempts deterministic verification.

### POST /api/v1/claims/:claimId/escrow-intent (Phase 14d-2: USDT live)

Auth: session + buyer owner (foreign → 404 `CLAIM_NOT_FOUND`, anonymous → 401).

Request: `{ token: 'NIM' | 'USDT_POLYGON' }` (strict, no unknown fields).
`NIM` → 409 `ESCROW_TOKEN_UNSUPPORTED` (no row created); wrong claim state →
409 `CLAIM_NOT_PAYABLE`; funded → 409 `ESCROW_ALREADY_FUNDED`.

(Retired in 14f-r, 2026-09-17: NIM escrow intent was briefly live in
14f-1 and now returns 409 again. USDT on Polygon is the sole escrow
rail.)

Response: `{ escrow, claim, depositInstruction }` where the instruction
carries `contractAddress`, `tokenAddress` (canonical USDT ERC-20 address the
`approve()` call targets — served from `USDT_TOKEN_ADDRESS`, 503 when
unconfigured; added in P1 so the frontend never hardcodes it), `usdtAmount`
(string, 6-decimal base units), `onChainEscrowId`, `approveTo` (=
contractAddress), `approveAmount` (exact, = usdtAmount — exact-amount
approval only, never infinite), and `buyerWallet` (frontend sanity-check).
Existing escrow pre-funding → returned as-is (idempotent, no new row).

Rate limit: per-IP 10/60s (matches the deprecated intent path).

### POST /api/v1/claims/:claimId/escrow-submission (Phase 14d-2: USDT live)

Auth: session + buyer owner.

Request: `{ transactionHash: string }` (hex with optional `0x`, hex part
1–256 chars, matching the payment-submission bound). Sets `deposit_tx_hash`
on the escrow row and moves the claim `active_hold` → `deposit_submitted`.
Idempotent on identical hash; different hash while submitted → 409
`PAYMENT_ALREADY_SUBMITTED`; no escrow → 404 `ESCROW_NOT_FOUND`; funded →
409 `ESCROW_ALREADY_FUNDED`. The hash is an unverified buyer reference;
verification happens in `verify-deposit`.

Rate limit: per-IP 10/60s.

### POST /api/v1/claims/:claimId/verify-deposit (Phase 14d-2: USDT live)

Auth: session + buyer owner, and safe to call repeatedly (buyer polling;
no background worker).

Request: strict empty (`{}` accepted). Reads the contract `Deposited` event
for the escrow's `on_chain_escrow_id` and assesses escrow id → exact
amount. `pending` → 200 no-op `{ status: 'pending' }`; `mismatch` →
200 `{ status: 'mismatch', reason }` with no write (claim stays
`deposit_submitted`); `matched` → one transaction funds both rows (escrow →
`funded` with `deposit_tx_hash`/`funded_at`/`delivery_deadline`, claim →
`escrow_funded`). Expired window + `pending` → `payment_review` with
`{ status: 'review' }` (inventory NOT released); `matched` past the window
still verifies. Already funded → 200 `{ status: 'funded' }` without an RPC
call. RPC/contract misconfiguration → 503 `ESCROW_CONTRACT_UNAVAILABLE`
with no state change.

Rate limit: per-claim 1/5s (same as deprecated `verify-payment`) → 429
`VERIFY_RATE_LIMITED` with `Retry-After`.

### POST /api/v1/claims/:claimId/mark-delivered (Phase 14d-3a: USDT live)

Auth: session + provider owner of the slot only (buyer or stranger → 404
`CLAIM_NOT_FOUND`, anonymous → 401).

Request: `{ providerPayoutAddress: string }` (strict, `0x` + 40 hex, else
400 `INVALID_INPUT`). Claim must be `escrow_funded`, escrow `funded`;
anything else → 409 `CLAIM_NOT_PAYABLE`.

Response: `{ escrow, claim }` with both rows `delivered`,
`provider_payout_address` stored (lowercased), `delivered_at` and
`dispute_window_ends` (= now + `ESCROW_DISPUTE_WINDOW_SECONDS`) set, and an
`escrow.delivered` audit. Idempotent re-call with the same address → 200
no-op; different address → 409 `CONFLICT`.

Rate limit: per-IP 10/60s.

### POST /api/v1/claims/:claimId/confirm-receipt (Phase 14d-3a: USDT live)

Auth: session + buyer owner only (foreign → 404, anonymous → 401).

Request: strict empty (`{}` accepted). Claim/escrow must be `delivered`,
else 409 `CLAIM_NOT_PAYABLE`. First call broadcasts the server-signed
contract `release()` and stores `release_tx_hash` (rows stay `delivered`,
`escrow.release_submitted` audit), returning 200 `{ status: 'pending',
escrow, claim }`. Later calls poll the receipt: unknown → `{ status:
'pending' }`; under `ESCROW_RELEASE_CONFIRMATIONS` → `{ status: 'pending',
confirmations, ... }`; at/over → one transaction flips both rows to
`released` (`resolved_at`, `escrow.released` audit). Already `released` →
200 no-op without any RPC call. Signer/RPC/contract failure → 503
`ESCROW_RELEASE_FAILED` with no state change.

Poll target (P3 note, 14e E2E finding): the buyer confirms by polling
THIS endpoint, not `GET /escrow`. The first call stores
`release_tx_hash` while the rows stay `delivered` — and `delivered`
is not a lazy-transition state — so reads never observe the
confirmation count or flip the rows. Only repeated `POST
confirm-receipt` receipt-polls a broadcast release into `released`.

Rate limit: per-IP 10/60s.

### POST /api/v1/claims/:claimId/dispute (Phase 14d-3b: USDT live)

Auth: session + buyer owner only (foreign → 404, anonymous → 401).

Request: strict empty (`{}` accepted). Claim/escrow must be `delivered`,
else 409 `CLAIM_NOT_PAYABLE`; past `dispute_window_ends` → 409
`ESCROW_DISPUTE_WINDOW_CLOSED`. One endpoint, two behaviors: while the
contract's `Disputed` event for the escrow is not visible, returns 200
`{ status: 'pending', disputeInstruction: { contractAddress,
onChainEscrowId, callData }, escrow, claim }` with no state change (the
buyer signs and broadcasts `dispute(escrowId)` from their own wallet); once
the event is visible, one transaction flips both rows to `disputed`
(`disputed_at`, `escrow.disputed` audit), returning 200
`{ status: 'disputed', escrow, claim }`. Already `disputed` → 200 no-op.

Rate limit: per-IP 10/60s.

### GET /api/v1/claims/:claimId/escrow (Phase 14d-2: USDT live, 14d-3a extended, 14d-3b lazy transitions)

Auth: session + buyer owner or provider owner of the slot (neither → 404,
anonymous → 401).

Returns `{ escrow, claim }` for the claim's escrow (`ESCROW_NOT_FOUND` when
none exists), including `provider_payout_address`, `delivered_at`,
`dispute_window_ends`, `disputed_at`, `release_tx_hash`, `refund_tx_hash`,
`resolved_at`, and `status`. `resolution_notes` is populated for the
provider view only (the buyer view carries null). Phase 14d-4: the buyer
view's `claim` carries the same gated `provider_contact_note` as
`GET /claims/:claimId` (evaluated against the post-transition escrow
status, so a funded row that flips to `refunding` on this same read hides
the note); the provider view's `claim` carries null — the provider already
has the note on their slot owner projection. This is the opposite direction
from `resolution_notes` (provider/admin-visible, buyer-hidden); the two
fields must not be conflated. No rate limiter
beyond the shared API backstops.

Lazy transitions run BEFORE the projection: a `funded` escrow past its
`delivery_deadline` broadcasts `refund()` and returns `refunding`;
`refunding`/`releasing` rows with met confirmation policies return
`refunded`/`released`. Only those three states transition on reads: a
buyer-initiated release broadcast leaves the rows `delivered` (with
`release_tx_hash` set), so `GET /escrow` never flips a buyer release to
`released` — the buyer must poll `POST confirm-receipt` (see above).
A due transition with an unreachable chain fails
closed (503); rows that cannot transition are returned without any chain
call, so reads keep working when the RPC is down. NOT triggered from
`GET /me/claims` (no side effects from a list view).

### GET /api/v1/me/claims

Auth: session.

Buyer history.

### POST /api/v1/reports

Auth: session.

Creates abuse report. Body: `{ slotId?, targetUserId?, reason, details? }`
with `reason` in the PROJECT_SPEC.md FR-10 categories
(`misleading_listing|unauthorized_listing|prohibited_content|payment_issue|other`,
snake_case stored value and API field); at least one target required;
self-reports rejected (400); missing slot/user → 404.
Rate limit: 5 creations per hour per user → 429 `REPORT_RATE_LIMITED`.
Responds 201 with the open report and writes `report.created`.

### GET /api/v1/admin/reports

Auth: admin (anonymous → 401, non-admin → 403 `FORBIDDEN`, never 404).

Query: `status` (open|reviewed|dismissed), `limit`, `offset`. Sort
`created_at` DESC. Reports carry truncated reporter/target wallets plus slot
info — never full wallets.

### POST /api/v1/admin/reports/:reportId/resolve

Auth: admin.

Body: `{ action: 'reviewed' | 'dismissed', resolutionNotes (5–1000 chars) }`.
Records the outcome only; takes no automatic further action. Writes
`report.resolved`.

### POST /api/v1/admin/slots/:slotId/disable

Auth: admin.

Body: `{ reason (5–1000 chars) }`. Allowed on `draft`/`published` only,
otherwise 409 `SLOT_NOT_DISABLEABLE`. In ONE transaction: `active_hold`
claims → `cancelled`, `payment_pending` claims → `payment_review`, paid
claims untouched, slot → `cancelled` with `available_quantity = 0`. Writes
`slot.disabled_by_admin`. Response carries `migratedClaims` plus a warning
when any payment moved to review.

### POST /api/v1/admin/users/:userId/disable

Auth: admin.

Body: `{ reason (5–1000 chars) }`. In ONE transaction: user → `disabled`
with `disabled_at`, all active sessions revoked. Slots and claims are NOT
touched. Self-disable → 409 `CANNOT_DISABLE_SELF`. Writes `user.disabled`.
A disabled user hears 401 `ACCOUNT_DISABLED` on any authenticated request,
even when a session row survives (belt-and-suspenders with the revocation).

### GET /api/v1/admin/payment-reviews

Auth: admin (401/403 as above).

Query: `limit`, `offset`. Claims in `payment_review` with full
reconciliation context (full buyer wallet, slot price/payout, complete
intent terms) — deliberately more than buyers/providers ever see.

### POST /api/v1/admin/payment-reviews/:claimId/resolve

Auth: admin.

Body: `{ action: 'confirm_paid' | 'reject', resolutionNotes (5–1000) }`.
`confirm_paid` is an override (no chain re-check): intent → `verified`,
claim → `paid`. `reject`: intent → `rejected`, claim → `cancelled`, and
stock returns unless the slot itself is cancelled. Non-review claims →
409 `CLAIM_NOT_IN_REVIEW`. Writes `payment_review.resolved`.

### GET /api/v1/admin/audit-events

Auth: admin (401/403 as above).

Query: `eventType`, `entityType`, `entityId`, `actorUserId`, `since`,
`until`, `limit`, `offset`. Sort `created_at` DESC. Actors are truncated
wallets; metadata holds IDs/states/reasons only — never wallets, tx
hashes, or credentials.

### GET /api/v1/admin/escrows (Phase 14d-3b: USDT live)

Auth: admin (anonymous → 401, non-admin → 403 `FORBIDDEN`, never 404).

Query: `status` (any of the eight `escrow_status` values), `limit`, `offset`.
Sort `created_at` DESC. Every row in the returned page runs the lazy
transition check before projection, so delivery-timeout refunds and
confirmed releases/refunds land without any admin action. Full
reconciliation context per row: buyer wallet (full — admin eyes only),
provider payout address, on-chain escrow id, amounts, all timestamps, all
tx hashes, `resolution_notes`, `resolved_by_user_id`, and claim status.
No private keys or signature bodies anywhere in the response (only public
chain identifiers). Rows deleted between page query and projection are
skipped, never 500.

### POST /api/v1/admin/escrows/:escrowId/resolve (Phase 14d-3b: USDT live)

Auth: admin (anonymous → 401, non-admin → 403).

Body: `{ action: 'release' | 'refund', resolutionNotes }` (strict;
notes 5–1000 chars after trimming, matching the existing admin resolve
bodies). Escrow must be `disputed`, else 409 `ESCROW_DISPUTE_NOT_OPEN`.
The conditional `disputed → releasing`/`refunding` update admits exactly
one winner (0 rows on a re-read resolving state → 409 `CONFLICT`);
the winner broadcasts the server-signed `release()`/`refund()`, stores the
tx hash with `resolutionNotes`/`resolved_by`, and writes the
`escrow.releasing`/`escrow.refunding` audit, returning 200
`{ status: 'pending', escrow }`. Signer/RPC failure compensates back to
`disputed` → 503 `ESCROW_RELEASE_FAILED` / `ESCROW_REFUND_FAILED` with no
state change. The terminal flip happens on a later read once the
confirmation policy is met.

### Phase 10 implementation note (2026-09-11)

Admin identity is `ADMIN_WALLET_ADDRESSES` (comma-separated canonical
wallets): allowlisted wallets are promoted to `admin` on
POST /auth/verify and never auto-demoted (re-authentication picks up env
changes). Audit rows are written INSIDE the same DB transaction as the
action they describe (retrofitted: `user.created`, `slot.published`,
`slot.cancelled`, `claim.created`, `payment.submitted`, `payment.verified`,
`payment.review`; new: `report.created`, `report.resolved`,
`slot.disabled_by_admin`, `user.disabled`, `payment_review.resolved`).
Idempotent re-returns never log. Admin endpoints carry a generous per-IP
backstop limiter behind admin auth (Phase 12; abuse tripwire, not the
control — admin auth + audit remain the control); only POST /reports is
tightly rate-limited (5/hour per user).

## 14. Rate limiting

Apply separate limits:

- auth challenge: strict per IP + wallet address
- auth verify: strict per IP + wallet address
- public slot read: moderate
- create/publish/claim/payment submission: strict per session + IP
- report creation: moderate
- admin: protected and audited

Exact numeric values are configuration, not business rules.

**IMPLEMENTATION DETAIL — AGENT MAY DECIDE:** the exact rate-limit package and storage mechanism, provided it works for the deployed single-region MVP and can fail closed for sensitive endpoints.

## 15. Error codes

Minimum stable codes:

- INVALID_INPUT
- AUTH_REQUIRED
- AUTH_INVALID
- AUTH_EXPIRED
- FORBIDDEN
- FORBIDDEN_ORIGIN
- MISSING_CLIENT_HEADER
- NOT_FOUND
- USER_DISABLED
- SLOT_UNAVAILABLE
- SLOT_EXPIRED
- SLOT_CANCELLED
- CLAIM_EXPIRED
- CLAIM_NOT_PAYABLE
- CLAIM_ALREADY_PAID
- PAYMENT_INTENT_EXISTS
- PAYMENT_INTENT_REQUIRED
- PAYMENT_ALREADY_SUBMITTED
- PAYMENT_INVALID_TX
- PAYMENT_NOT_FOUND
- PAYMENT_NOT_CONFIRMED
- PAYMENT_AMOUNT_MISMATCH
- PAYMENT_SENDER_MISMATCH
- PAYMENT_RECIPIENT_MISMATCH
- PAYMENT_DATA_MISMATCH
- PAYMENT_REPLAY
- CLAIM_NOT_IN_PAYMENT_PENDING
- VERIFY_RATE_LIMITED
- RPC_UNAVAILABLE
- REPORT_RATE_LIMITED
- SLOT_NOT_DISABLEABLE
- CANNOT_DISABLE_SELF
- CLAIM_NOT_IN_REVIEW
- ACCOUNT_DISABLED
- CONFLICT
- RATE_LIMITED
- INTERNAL_ERROR
- ESCROW_NOT_FOUND
- ESCROW_ALREADY_FUNDED
- ESCROW_DEPOSIT_MISMATCH
- ESCROW_NOT_DELIVERED
- ESCROW_DISPUTE_WINDOW_CLOSED
- ESCROW_ALREADY_DISPUTED
- ESCROW_DISPUTE_NOT_OPEN
- ESCROW_RELEASE_FAILED
- ESCROW_REFUND_FAILED
- ESCROW_WALLET_UNAVAILABLE
- ESCROW_RECONCILIATION_BROKEN
- ESCROW_TOKEN_UNSUPPORTED
- ESCROW_CONTRACT_UNAVAILABLE

## 16. Security threat model

### Authentication attacks

Threats: forged signatures, nonce replay, session theft.

Mitigations:
- server-generated nonce;
- single-use challenge;
- expiration;
- signature verification;
- Secure/HttpOnly/SameSite session cookie;
- revoke sessions on logout;
- never trust wallet address from client as identity without signature.

### Authorization / IDOR

Threat: user changes UUID in URL to access someone else’s claim/slot.

Mitigation: resource lookup followed by explicit owner/role comparison on every protected mutation/read.

### Injection

Threats: SQL injection, HTML injection, unsafe JSON.

Mitigations:
- Drizzle parameterization;
- Zod validation;
- React escaping;
- no raw HTML rendering;
- safe URL validation for image fields.

### XSS

No user-provided HTML. Descriptions render as text/escaped Markdown only if a sanitizer is intentionally added later.

### CSRF

Origin allowlist validation + required X-Takeover-Client header on credentialed mutations, plus SameSite=None; Secure in production.

Every state-changing request (POST/PATCH/PUT/DELETE) that carries the session cookie must also carry an allowlisted Origin header (missing or unlisted → 403 FORBIDDEN_ORIGIN) and the custom `X-Takeover-Client: web` header sent by the web client on mutations only (missing or wrong → 403 MISSING_CLIENT_HEADER). The custom header forces a CORS preflight for any cross-origin request, and preflight is already allowlist-gated, so a foreign page can neither send the header nor read the response. Requests without a session cookie (nothing auto-attached to steal) and idempotent methods are unaffected.

Bearer exemption (Phase 14c, owner approved): a request authenticated SOLELY via `Authorization: Bearer <session-token>` — no session cookie present — skips the Origin/header requirement. Justification: unlike the cookie, the token is never auto-attached by the browser, and sending `Authorization` cross-origin forces a CORS preflight that is already allowlist-gated, so a foreign origin can neither send the header nor read the response; the CORS allowlist remains the boundary for this path. Precedence: when a session cookie IS present (even alongside a Bearer token), the cookie path — and this guard in full — applies unchanged.

### SSRF

Do not fetch arbitrary user-supplied URLs server-side in MVP. Image URL is display-only.

### Rate abuse

Rate-limit authentication, claims, and payment endpoints.

### Replay attacks

Challenge nonce single-use; payment transaction hash unique; claim/payment intents unique; state transitions idempotent.

### Race conditions

DB row locks + unique constraints + atomic transactions.

### Payment manipulation

Never trust amount/recipient/sender/tx data from browser after payment intent creation. Read from server-side payment intent and blockchain.

### Secrets

All secrets server-only. The Polygon contract signer key is a server-only secret (KMS in production); it is never logged, printed, returned, or committed. (F3 cleanup, 2026-09-17: the NIM escrow wallet private key named here before no longer exists — the 14g-1 fee wallet is receive-only and has no server-side key.)

### Sensitive data exposure

Log request IDs and high-level event names, never signatures/cookies/tokens/private environment values.

### Admin privilege escalation

Role is server-controlled. Never accept role changes from client input. Admin membership should use an environment-backed allowlist or server-maintained role assignment.

### Custody and smart-contract threats

- Smart-contract vulnerability (USDT): reentrancy, integer issues, access control. Mitigation: OpenZeppelin base contracts, external audit, fuzz tests, exact-amount approvals, revoke after deposit.
- Server signer key compromise (USDT): key that can call contract release/refund. Mitigation: KMS in production, env secret for competition build, least-privilege signing service.
- NIM escrow wallet key compromise (not applicable in the current product
  scope — NIM escrow retired in 14f-r; analysis retained: KMS in production,
  env secret for competition build, cold/hot separation, balance monitoring).
- Ledger drift (not applicable in the current product scope — NIM escrow
  retired in 14f-r; analysis retained: double-entry invariant, periodic
  reconciliation against on-chain balance, halt on mismatch).
- Deposit replay across claims: UNIQUE deposit_tx_hash + claim binding.
- Release replay: UNIQUE release_tx_hash.
- Refund replay: UNIQUE refund_tx_hash.
- Contract event spoofing (USDT): backend verifies events from the contract address only, and validates the escrow id against its own DB record.

## 17. Third-party services

### Nimiq Pay / Mini App SDK — mandatory

Purpose: wallet identity/signing/payment initiation.

Auth: injected provider; no API secret in browser.

Failure: detect unavailable provider and show “Open in Nimiq Pay” or a test/development message.

### Nimiq blockchain read API — mandatory

Purpose: server-side verification of submitted NIM payment transactions.

Auth: public RPC if supported; otherwise server-side API credential.

Failure: payment remains PAYMENT_PENDING/REVIEW; never mark paid based on timeout.

### Polygon JSON-RPC — mandatory

Purpose: server-side verification of USDT escrow `Deposited` / `Released` / `Refunded` events from the configured escrow contract address.

Auth: public RPC if supported; otherwise server-side API credential. Endpoint configurable via `POLYGON_RPC_URL` (see §22).

Failure: fail closed — escrow state unchanged, never optimistic; the claim stays in its current state until the event is observed.

### Supabase Postgres — mandatory infrastructure choice

Purpose: persistent database.

Auth: DATABASE_URL server-only.

### Hosting — mandatory class, provider fixed for initial deployment

Frontend: Vercel.
Backend: Railway.
Database: Supabase.

## 18. No-AI decision

AI is not part of the MVP architecture. Matching, listing quality, fraud scoring, and pricing are deterministic.

Future AI must never be allowed to decide payment verification, ownership, eligibility, or final state transitions.

## 19. UI architecture

### Phase 9 implementation note (2026-09-11)

Buyer/provider dashboards add no new wallet SDK usage and no new columns
(`provider_profiles.display_name` already exists). `/profile` is a real
page (truncated wallet with click-to-copy, role, display-name setup/edit,
shortcuts, logout) behind the shared `RequireAuth`, which now preserves the
requested route and returns to it after login. `/claims` groups holds into
five collapsible buckets from one fetch. `/sell` shows Active/Drafts/
Sold-out tiles plus per-card hold counts from the provider claims endpoint.
Display rule everywhere: names preferred, truncated wallets as fallback;
truncation never throws, so a corrupt stored wallet degrades a label instead
of breaking reads (strict canonicalization stays mandatory on
payment/verification paths).

### Routes

Public/user routes:
- `/` marketplace
- `/slot/:slotId` slot detail
- `/claim/:claimId` claim/payment status
- `/claims` buyer claims
- `/sell` create slot
- `/sell/:slotId` manage own slot
- `/profile`

Admin:
- `/admin`
- `/admin/reports`
- `/admin/payment-reviews`
- `/admin/users`
- `/admin/slots`
- `/admin/audit`

### Phase 10 implementation note (2026-09-11)

Admin pages add no new wallet SDK usage and no transactions. `RequireAdmin`
passes only authenticated `role='admin'` users; others return to `/` with a
notice. The dashboard tiles read live totals from the locked admin lists
(open reports, payment reviews) and audit-event totals for disabled users
and listings (no re-enable endpoints exist). `/admin/users` and
`/admin/slots` work from moderation-surfaced people/listings plus direct-id
disable forms — no dedicated admin directory endpoints were added (locked
API surface). New shared components: `AdminTable`, `AdminTile`,
`ResolveDialog`, `DisableDialog`; plus `ReportDialog` behind the report
button on `/slot/:slotId` (authenticated non-admin viewers only, never the
listing's own provider, never admins).

### Phase 11 implementation note (2026-09-11)

Finishing pass only: no API, payment-logic, or feature changes. Routes are
code-split (`React.lazy` — one chunk per route file, admin chunks load only
on admin routes). A top-level `ErrorBoundary` plus an admin-group boundary
keep crashes branded and isolated. Dialogs trap focus, close on Escape, and
return focus to the trigger; the hold countdown announces only at the
5 min / 1 min / 30s / 10s thresholds; motion stops under
`prefers-reduced-motion`. Design tokens (`min-h-touch`, `min-w-admintable`,
documented palette/type scale) live in the Tailwind config; per-route
titles/descriptions, slot OG previews, favicon, and admin `noindex` ship
via a small meta hook. New shared pieces: `ErrorBoundary`,
`useDialogFocus`, `usePageMeta`, `NotFound` route.

### Shared components

- AppShell
- TopBar
- WalletStatus
- SearchFilters
- SlotCard
- SlotList
- SlotDetail
- PriceDisplay
- TimeBadge
- AvailabilityBadge
- ClaimButton
- PaymentPanel
- StatusTimeline
- EmptyState
- LoadingSkeleton
- ErrorState
- ConfirmDialog
- FormField
- Toast/InlineAlert
- BottomNav (mobile)

## 20. UX rules

- Primary action is always clear: Claim, Publish, Pay, View claim.
- Time sensitivity is visually obvious but not manipulative.
- Never hide material price/payment information.
- Payment screen states exactly how much NIM is being sent and where it goes before opening the wallet confirmation.
- Never show “Paid” until backend verification succeeds.
- Disabled/unavailable actions must explain why.
- Avoid crypto jargon unless necessary.
- Mobile first; desktop receives a centered wider layout, not a completely different app.

## 21. Accessibility

- Keyboard navigable controls.
- Visible focus state.
- Minimum touch target around 44px.
- Form labels associated with inputs.
- Status changes announced where practical.
- Color cannot be the only indicator.
- Sufficient text contrast.
- Reduced-motion support.

## 22. Deployment architecture

```text
GitHub (public, MIT)
   |
   +--> Vercel: frontend
   |
   +--> Railway: API
             |
             +--> Supabase Postgres
             |
              +--> Nimiq read API
```

- Polygon RPC endpoint (configurable via POLYGON_RPC_URL)
- USDT contract address on Polygon
- TAKEOVER escrow contract address on Polygon
- Server signer address (contract caller)
- NIM listing-fee wallet address (receive-only; `TAKEOVER_FEE_WALLET_ADDRESS`, per-environment)
- Note: competition build may use env secrets for keys; production requires KMS.

Environment-specific configuration is separated between development and production.

No production secrets are committed.

### Chain target note (owner-verified 2026-09-18)

Nimiq Pay supports the following EVM chains: Ethereum mainnet, Polygon mainnet, Arbitrum One, Optimism, Base, BNB Smart Chain, and Sepolia (testnet). Polygon Amoy is NOT supported — the Mini App WebView cannot route transactions to it. Confirmed by the owner directly in Nimiq Pay: selecting a network returns "USDT is only available on mainnet." Consequently, both payment rails target mainnet: USDT escrow on Polygon mainnet; NIM listing fee on Nimiq mainnet. Testnet (Amoy / Nimiq testnet) was used during development only.

## 23. Observability

Every API request gets a request ID.

Structured logs record:
- request ID
- route
- response code
- latency
- authenticated user ID when safe
- business event name

Security/payment logs record event summaries, not secrets.

Minimum operational metrics:
- requests by route/status
- authentication failures
- claims created
- payment verification attempts
- payment verification failures
- successful payments
- escrows funded
- deliveries marked
- escrow releases
- escrow refunds
- disputes opened
- dispute resolutions
- listing-fee verifications (NIM)
- errors

## 24. Architecture invariants

The coding agent must treat these as non-negotiable:

1. React + Vite frontend.
2. Fastify backend.
3. PostgreSQL + Drizzle.
4. Nimiq wallet authentication.
5. Payment rails: USDT (ERC-20 on Polygon) escrowed by the non-custodial escrow contract; NIM (native Nimiq) as the env-gated listing fee paid by sellers at publish time (verified on-chain, receive-only wallet, no custody). (F3 cleanup, 2026-09-17: the dual-rail custodial NIM escrow was retired in 14f-r.)
6. Escrow: buyer funds are held in the Polygon smart contract (non-custodial). The escrow contract's state is authoritative for USDT. (F3 cleanup, 2026-09-17: the NIM custodial escrow wallet was retired in 14f-r; there is no NIM escrow balance to be authoritative.)
7. Server-authoritative payment verification.
8. DB transaction/locking around claims.
9. Explicit state machines.
10. No AI in the MVP.
11. No new infrastructure without approval.
