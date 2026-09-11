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
- Payments: NIM via Nimiq Pay; direct provider payout, no escrow
- Blockchain verification: Nimiq JSON-RPC/read API from server
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
Nimiq Pay
   |
   | embedded webview / browser
   v
React + Vite Mini App
   |
   | HTTPS JSON API
   v
Fastify API
   |
   +---- Auth / authorization
   +---- Marketplace business logic
   +---- Claim state machine
   +---- Payment intent creation
   +---- Blockchain payment verification
   +---- Moderation
   |
   v
PostgreSQL

Fastify ---> Nimiq RPC/read endpoint

No private keys are stored by TAKEOVER.
```

## 3. Architectural principles

1. Server is authoritative for user identity, ownership, listing state, claims, and payment state.
2. Browser state is advisory only.
3. Database transactions protect scarce inventory.
4. Every security-sensitive API checks authorization server-side.
5. Payment is not considered successful until server-side blockchain verification succeeds.
6. No user funds are held by TAKEOVER.
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

After successful signature verification, backend creates a random, opaque session identifier. Store the session hash server-side; return the raw session in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie when browser embedding permits it.

Session expiration: 7 days with sliding renewal on authenticated use, unless Nimiq Pay embedding constraints require a shorter period.

Logout destroys/revokes the session server-side.

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
- Buyer-owned: own claims, own payment intents.
- Provider-owned: own slots, claims attached to own slots.
- Admin-only: reports, audit events, moderation controls, user disable state.

Every API accepting a user-controlled ID must load the resource and compare the server-authenticated owner/role before mutation.

## 6. Payment architecture

### MVP payment model

Direct NIM payment from buyer wallet to provider payout address.

TAKEOVER does not receive, custody, or route customer funds.

### Payment intent

A payment intent is a server record created for exactly one claim. It contains:

- claim_id
- buyer_wallet
- provider_wallet
- amount_base_units
- expected_transaction_data
- status
- expires_at
- verified_transaction_hash
- created_at
- updated_at

The intent is immutable after issuance except for verification fields.

### Phase 7 implementation note (2026-09-11)

Intents are created per claim with `expected_data = 'TAKEOVER:v1:<claim-id>'`
and snapshots of amount/recipient/sender; repeat calls return the existing
intent. The buyer-facing projection omits `expected_sender` (server-side
reconciliation data). Payment submission records the client-supplied tx hash
and moves the claim to `payment_pending` with NO chain verification (Phase 8);
the tx_hash UNIQUE constraint is the replay guard. `payment_pending` has no
timeout path yet — known gap, deferred to Phase 8/10.

### Phase 7 completion — SDK return value resolution (2026-09-11, Case A)

`sendBasicTransactionWithData()` returns a transaction hash (64 hex chars, no
`0x` prefix), passed through unchanged as `tx_hash`. No schema change, no
endpoint change. Citations: installed
`node_modules/@nimiq/mini-app-sdk/dist/provider.d.ts:187-193` (signature
`Promise<string | ErrorResponse>`, stale JSDoc "@returns The serialized
transaction"); official
https://nimiq.dev/mini-apps/api-reference/nimiq-provider#sendbasictransactionwithdata
(Returns `string` — transaction hash); oracle
`node_modules/@nimiq/core/nodejs/main-wasm/index.js` (`Transaction.hash()`
"used as its unique identifier on the blockchain" vs `serialize()`/`toHex()`;
live: hash 64 hex, serialized 139/214 bytes). Frontend SDK path covered by a
mocked test; a real Nimiq Pay round-trip remains a Phase 14 item.

### Phase 8 implementation note (2026-09-11)

`POST /claims/:claimId/verify-payment` (buyer-only) reads the submitted hash
against the Nimiq JSON-RPC `getTransactionByHash` endpoint (default
`https://rpc.nimiqwatch.com`, overridable via `NIMIQ_RPC_URL`; raw fetch, 5s
timeout, no `@nimiq/core` in production). Only `payment_pending` triggers a
chain lookup; `paid`/`payment_review` return 200 no-ops. Mapping: tx not
found or confirmations < 3 → pending (never rejected); field mismatch
(sender/recipient/amount/data, BigInt-exact, byte-for-byte) → intent
`review` + claim `payment_review` with a generic client reason and
field-specific server log; confirmations >= 3 and all checks pass →
intent `verified` + claim `paid`. A still-pending verification older than
`PAYMENT_REVIEW_TIMEOUT_SECONDS` (default 1800) ages to `payment_review`
instead. `rejected` is admin-only (Phase 10) and is never emitted here.
Inventory is never restored on review or timeout. Per-claim rate limit (1 per
5s → 429 `VERIFY_RATE_LIMITED` + `Retry-After`); RPC failure → 503
`RPC_UNAVAILABLE` with no state change.

### Payment verification

```text
Buyer
  |
  | request payment intent
  v
Fastify
  |
  | exact recipient + amount + data
  v
React
  |
  | sendBasicTransactionWithData()
  v
Nimiq Pay
  |
  | blockchain tx
  v
Nimiq network
  |
  | read/verify
  v
Fastify
  |
  | DB transaction
  v
Payment VERIFIED -> Claim PAID -> Slot SOLD/CONSUMED
```

### Transaction data binding

Required data value should bind the payment to the exact claim, e.g. a versioned string:

`TAKEOVER:v1:<claim-uuid>`

The server calculates the expected value; the client never chooses it.

If Nimiq transaction-data size/format constraints require a different envelope, preserve the same semantic binding.

### No escrow decision

Escrow is explicitly out of MVP. This is intentional because implementing secure custody, refunds, release conditions, and a production-grade dispute path would multiply financial/security complexity.

### Payment finality

A payment is confirmed only according to a server-defined Nimiq verification policy. The exact confirmation criterion must be implemented against the current official Nimiq read API semantics.

**IMPLEMENTATION DETAIL — AGENT MAY DECIDE:** polling interval and exact RPC calls, provided verification is server-side and deterministic.

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
ACTIVE_HOLD -> EXPIRED
     |
     v
PAYMENT_PENDING -> PAID
     |
     -> PAYMENT_REVIEW

ACTIVE_HOLD -> CANCELLED (provider/admin only under allowed rules)
```

A user-submitted tx hash does not itself change the state to PAID.

### Payment states

```text
CREATED -> SUBMITTED -> VERIFIED
                    \-> REJECTED
                    \-> REVIEW
```

The same transaction cannot verify two successful payment intents.

## 9. Database model

Reconciled to the implemented Phase 2 schema on 2026-09-11 (follow-up): the Phase 2
schema is the source of truth. The migration SQL under `db/migrations/` is authoritative
for DDL; this section describes it.

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
- category TEXT NULL
- location_label TEXT NULL
- starts_at TIMESTAMPTZ NOT NULL
- ends_at TIMESTAMPTZ NULL
- price_nim BIGINT NOT NULL (integer NIM base units, no floats)
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
- price_nim > 0

### claims

- id UUID PK
- slot_id UUID FK slots.id
- buyer_id UUID FK users.id
- quantity INTEGER NOT NULL DEFAULT 1
- status ENUM(claim_status: active_hold, expired, payment_pending, paid, payment_review, cancelled) NOT NULL DEFAULT active_hold
- hold_expires_at TIMESTAMPTZ NOT NULL
- claimed_at TIMESTAMPTZ NOT NULL
- updated_at TIMESTAMPTZ NOT NULL

Constraints:
- quantity > 0

Unique/partial-index requirement:
- one live (active_hold, payment_pending, payment_review) claim per buyer+slot.
  paid, expired, and cancelled rows may repeat, so a buyer can accumulate multiple
  paid claims on a multi-quantity slot while holding only one live claim at a time.

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

Provider-private:
- own listing management fields
- buyer identifiers only to the minimum required to fulfill the claim
- claim/payment statuses for own slots

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

### POST /api/v1/slots/:slotId/publish

Auth: session + owner.

Publishes valid draft.

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

### POST /api/v1/claims/:claimId/payment-intent

Auth: session + buyer owner.

Creates or returns the existing payment intent. Must not mint multiple intents for one claim.

Idempotency-Key required.

### POST /api/v1/claims/:claimId/payment-submission

Auth: session + buyer owner.

Request:

```json
{ "transactionHash": "..." }
```

Server validates format and records submission, then attempts verification.

Idempotency-Key required.

### POST /api/v1/claims/:claimId/verify-payment

Auth: session + buyer owner, and safe to call repeatedly.

Server re-queries Nimiq state and attempts deterministic verification.

### GET /api/v1/me/claims

Auth: session.

Buyer history.

### POST /api/v1/reports

Auth: session.

Creates abuse report. Body: `{ slotId?, targetUserId?, reason, details? }`
with `reason` in `spam|fraud|misleading|inappropriate|other`; at least one
target required; self-reports rejected (400); missing slot/user → 404.
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

### Phase 10 implementation note (2026-09-11)

Admin identity is `ADMIN_WALLET_ADDRESSES` (comma-separated canonical
wallets): allowlisted wallets are promoted to `admin` on
POST /auth/verify and never auto-demoted (re-authentication picks up env
changes). Audit rows are written INSIDE the same DB transaction as the
action they describe (retrofitted: `user.created`, `slot.published`,
`slot.cancelled`, `claim.created`, `payment.submitted`, `payment.verified`,
`payment.review`; new: `report.created`, `report.resolved`,
`slot.disabled_by_admin`, `user.disabled`, `payment_review.resolved`).
Idempotent re-returns never log. Admin endpoints carry no per-IP rate
limit beyond admin auth; only POST /reports is rate-limited.

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

Cookie-based session requires SameSite and CSRF protections appropriate to the deployed embedding. State-changing endpoints should also require an anti-CSRF token/header if cross-site requests could be accepted.

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

All secrets server-only. No private keys are needed for normal operation.

### Sensitive data exposure

Log request IDs and high-level event names, never signatures/cookies/tokens/private environment values.

### Admin privilege escalation

Role is server-controlled. Never accept role changes from client input. Admin membership should use an environment-backed allowlist or server-maintained role assignment.

## 17. Third-party services

### Nimiq Pay / Mini App SDK — mandatory

Purpose: wallet identity/signing/payment initiation.

Auth: injected provider; no API secret in browser.

Failure: detect unavailable provider and show “Open in Nimiq Pay” or a test/development message.

### Nimiq blockchain read API — mandatory

Purpose: server-side verification of submitted NIM payment transactions.

Auth: public RPC if supported; otherwise server-side API credential.

Failure: payment remains PAYMENT_PENDING/REVIEW; never mark paid based on timeout.

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

Environment-specific configuration is separated between development and production.

No production secrets are committed.

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
- errors

## 24. Architecture invariants

The coding agent must treat these as non-negotiable:

1. React + Vite frontend.
2. Fastify backend.
3. PostgreSQL + Drizzle.
4. Nimiq wallet authentication.
5. NIM-only MVP.
6. Direct provider payout; no custody/escrow.
7. Server-authoritative payment verification.
8. DB transaction/locking around claims.
9. Explicit state machines.
10. No AI in the MVP.
11. No new infrastructure without approval.
