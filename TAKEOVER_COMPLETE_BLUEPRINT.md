# TAKEOVER — Complete Pre-Implementation Blueprint

Date: 2026-09-11
Status: Design complete; implementation intentionally not started.

This is the consolidated index for the five implementation handoff documents. The project uses the Proper Vibe Coding Workflow: specification first, fixed architecture, small independently verifiable phases, tests/evidence, checkpoints, and an explicit separation between human product decisions and agent implementation.

## 1. Product definition

**Name:** TAKEOVER

**One line:** A last-minute marketplace for released/scarce capacity.

**Problem:** Providers have valuable slots that become available too late for normal sales channels, while buyers needing something soon cannot easily discover them.

**Alternatives:** manual waitlists, calls/texts, social posts, normal booking pages, and broad marketplaces.

**Target:** buyers seeking immediate availability and providers authorized to sell/reallocate capacity.

**Roles:** Buyer, Provider, Admin. One wallet identity may act as Buyer and Provider.

**Value:** monetize otherwise-idle capacity while making real-time availability discoverable.

**Differentiator:** the product is centered on time-sensitive scarce capacity rather than generic business discovery.

**Primary use case:** provider publishes a near-term slot; buyer claims and pays NIM; backend verifies payment; claim becomes confirmed.

**Secondary use cases:** restaurants, classes, sports courts, salons/services, local services, authorized event seats.

**Does not do:** arbitrary consumer reservation transfers, scraping, calendar sync, escrow, fiat, USDT, AI matching, ratings, native apps, complex chat/CRM, or advanced analytics in MVP.

## 2. MVP scope

**Must:** wallet identity, marketplace, filters, slot creation/publishing, slot details, claim/hold, NIM payment initiation, server-side transaction verification, buyer/provider views, reports/admin moderation, audit log, mobile UX, HTTPS deployment, tests.

**Should:** admin verification badge, location sorting, share links, in-app status notices, safe seed tooling.

**Nice:** basic analytics, better map presentation, lightweight waitlist.

**Future:** consumer reservation release, integrations, AI matching, dynamic pricing, NIM+USDT, escrow/refunds, reputation, push notifications, native apps.

**Out:** everything else.

## 3. User roles

Buyer: browse, claim, pay, view own claims.

Provider: publish/manage own slots and view their claim/payment states. Supply is self-attested in MVP.

Admin: moderate, disable, inspect operational data, and resolve exceptions. Admin actions are audited.

## 4. User flows

### Authentication

```text
Mini App -> request challenge -> wallet signs -> API verifies -> session -> app
```

Failure: invalid/expired/replayed signature returns safe auth error.

### Provider publish

```text
Provider -> Sell -> validate -> create DRAFT -> publish -> PUBLISHED -> marketplace
```

Only owner can modify draft. Published commercial fields are immutable.

### Buyer claim

```text
Buyer -> Slot -> Claim -> DB row lock -> recheck availability -> INSERT claim -> decrement quantity -> ACTIVE_HOLD
```

Failure: sold out, expired, unauthorized, duplicate active claim, or conflict.

### Payment

```text
ACTIVE_HOLD -> payment intent -> Nimiq Pay send NIM -> submit tx hash -> server verifies chain -> PAID
```

The browser never controls the authoritative paid state.

### Payment exception

```text
PAYMENT_PENDING -> verified = PAID
PAYMENT_PENDING -> verification window exceeded = PAYMENT_REVIEW
```

Do not silently release a claim that may have a real payment associated with it.

## 5. Functional requirements

FR-01 wallet authentication.
FR-02 active marketplace discovery.
FR-03 provider slot creation.
FR-04 publishing.
FR-05 atomic claims.
FR-06 NIM payment verification.
FR-07 buyer claims.
FR-08 provider slots.
FR-09 unpaid cancellation.
FR-10 reporting.
FR-11 admin moderation.

Acceptance is the complete clean-user flow from Mini App opening through authenticated discovery, claim, real NIM payment, server verification, confirmation, and safe handling of races/manipulation.

## 6. Business logic/state machines

Slot:

```text
DRAFT -> PUBLISHED -> SOLD_OUT
              |  \-> CANCELLED
              \-> EXPIRED
```

Claim:

```text
ACTIVE_HOLD -> EXPIRED
     |
     v
PAYMENT_PENDING -> PAID
                  \-> PAYMENT_REVIEW
```

Payment:

```text
CREATED -> SUBMITTED -> VERIFIED
                    \-> REJECTED
                    \-> REVIEW
```

Rules include exact inventory protection, one active claim per buyer/slot, single-use auth challenges, immutable published commercial fields, deterministic payment verification, and replay prevention.

## 7. Data model

Entities: users, sessions, auth_challenges, provider_profiles, slots, claims, payment_intents, reports, audit_events.

Core relationships:

```text
users 1---1 provider_profiles
users 1---* slots
users 1---* claims
slots 1---* claims
claims 1---1 payment_intents
users 1---* reports
users 1---* audit_events
```

See `ARCHITECTURE.md` for full fields, types, constraints, indexes, and exposure rules.

## 8. System architecture

```text
Nimiq Pay
   |
React + Vite Mini App
   | HTTPS JSON
Fastify API
   |
PostgreSQL/Drizzle ---- Nimiq read API
```

No private keys. No app custody. No AI in financial/state decisions.

## 9. Technology stack

Frontend: React + TypeScript + Vite + Tailwind + official Nimiq Mini App SDK.

State: Zustand only for genuinely shared client state.

Backend: Node.js + TypeScript + Fastify + Zod.

Database: PostgreSQL + Drizzle; Supabase-hosted initially.

Deployment: Vercel frontend + Railway API + Supabase DB.

Authentication: wallet signature challenge + opaque server session.

Payments: NIM via Nimiq Pay.

Search: indexed PostgreSQL filtering.

No cache/queue/search cluster required for MVP.

## 10. API specification

Required routes:

```text
POST /api/v1/auth/challenge
POST /api/v1/auth/verify
POST /api/v1/auth/logout
GET  /api/v1/me
GET  /api/v1/slots
GET  /api/v1/slots/:slotId
POST /api/v1/slots
PATCH /api/v1/slots/:slotId
POST /api/v1/slots/:slotId/publish
POST /api/v1/slots/:slotId/cancel
GET  /api/v1/me/slots
POST /api/v1/slots/:slotId/claims
GET  /api/v1/claims/:claimId
POST /api/v1/claims/:claimId/payment-intent
POST /api/v1/claims/:claimId/payment-submission
POST /api/v1/claims/:claimId/verify-payment
GET  /api/v1/me/claims
POST /api/v1/reports
GET  /api/v1/admin/reports
POST /api/v1/admin/slots/:slotId/disable
POST /api/v1/admin/users/:userId/disable
```

Stable response envelope:

```json
{"data": {}, "requestId": "..."}
```

Stable error envelope:

```json
{"error":{"code":"SLOT_UNAVAILABLE","message":"This slot is no longer available."},"requestId":"..."}
```

Sensitive mutations require auth, authorization, validation, and idempotency where specified.

## 11. Database behavior

Claiming uses `BEGIN -> SELECT slot FOR UPDATE -> validate -> INSERT claim -> UPDATE quantity -> COMMIT`.

Expired holds restore reserved quantity exactly once.

Payment verification updates payment, claim, and slot state in a DB transaction after deterministic chain validation.

Payment transaction hashes are unique. Active buyer/slot claims use a uniqueness guard.

## 12. Authentication/authorization

Canonical identity is the verified Nimiq wallet address. Challenge is server-generated, single-use, five minutes, and wallet-bound.

Session is opaque, server-stored/hashed, secure, HttpOnly, SameSite appropriate to the Mini App deployment.

Authorization checks resource ownership or admin role on every protected read/mutation.

Client-provided role/owner/status values are never trusted.

## 13. Security architecture

Threats and controls:

- Auth replay -> single-use expiring nonce.
- IDOR -> server-side owner check.
- privilege escalation -> server-controlled role.
- injection -> Zod + parameterized DB access.
- XSS -> escaped text, no raw HTML.
- CSRF -> appropriate SameSite and anti-CSRF controls for cookie mutations.
- SSRF -> no server-side arbitrary URL fetching.
- brute force -> rate limits.
- payment replay -> unique verified transaction hash.
- payment manipulation -> server-generated intent + server chain verification.
- race condition -> row locks + DB constraints.
- secrets -> server-only env values.
- webhook attacks -> not applicable to core NIM flow; any future webhook must authenticate and deduplicate.
- AI prompt injection -> N/A in MVP.

## 14. UI/UX architecture

Routes:
`/`, `/slot/:slotId`, `/claim/:claimId`, `/claims`, `/sell`, `/sell/:slotId`, `/profile`, `/admin`, `/admin/reports`, `/admin/users`, `/admin/slots`.

Reusable components include AppShell, WalletStatus, SearchFilters, SlotCard, SlotDetail, PriceDisplay, AvailabilityBadge, ClaimButton, PaymentPanel, StatusTimeline, EmptyState, LoadingSkeleton, ErrorState, FormField, ConfirmDialog, and mobile BottomNav.

Every important route has loading, empty, error, success, and unavailable states.

## 15. Design system

Visual direction: fast, trustworthy, consumer marketplace, modern but not futuristic/crypto-heavy. Strong hierarchy around time, availability, price, and location.

Use generous spacing, crisp cards, restrained borders, clear primary actions, compact metadata, and mobile-first layouts.

Primary action language: Claim / Pay / Publish.

Accessibility: keyboard navigation, visible focus, 44px-scale touch targets, labels, contrast, status not conveyed only by color, reduced-motion support.

## 16. Third-party integrations

Mandatory: Nimiq Pay SDK, Nimiq blockchain read API, PostgreSQL/Supabase.

Hosting: Vercel + Railway.

No external calendar, AI, email, SMS, analytics, maps, or payment providers required for MVP.

## 17. AI architecture

None in MVP.

Future AI is explicitly prohibited from deciding payment verification, wallet ownership, authorization, refunds, or irreversible state.

## 18. Payment architecture

NIM-only. Buyer sends the exact server-generated amount directly to provider wallet via Nimiq Pay.

Payment intent binds claim ID, buyer wallet, provider wallet, amount, and versioned transaction data.

Backend verifies existence, confirmation/finality, sender, recipient, exact amount, expected data, and transaction uniqueness.

No escrow and no automated refunds in MVP.

## 19. Admin / operations

Admin features are minimal: reports, user disable, listing disable, audit review, and exception resolution for payment review cases.

All admin mutations create audit events.

## 20. Edge-case matrix

Invalid input -> 400-safe error, no mutation.

Unauthenticated protected call -> AUTH_REQUIRED.

Unauthorized resource -> FORBIDDEN or NOT_FOUND according to safe enumeration policy.

Duplicate claim -> existing active claim or conflict; no second reservation.

Expired hold -> restore inventory exactly once.

Concurrent claim -> one commits, the other gets SLOT_UNAVAILABLE/CONFLICT.

Bad payment amount/recipient/sender/data -> payment rejected, claim not paid.

Unknown/unconfirmed tx -> remain pending/review; never paid.

RPC/database failure -> safe retry/recovery; never optimistic payment success.

Client retries -> idempotent sensitive mutations.

Disabled account -> no new marketplace mutations.

## 21. Testing strategy

Unit: state transitions, NIM amount arithmetic, validation, expiration, payment-verification predicates.

Integration: auth endpoints, ownership checks, DB transactions, claim concurrency, payment intent lifecycle.

E2E: authenticate -> browse -> claim -> pay -> verify -> confirm; provider view; race scenario.

Security: IDOR, role forgery, nonce replay, tx replay, amount/recipient tampering, malformed input, brute-force/rate-limit behavior, race conditions.

Acceptance: all MVP must-have flows pass on a clean environment and inside Nimiq Pay.

## 22. Repository structure

```text
takeover/
├── PROJECT_SPEC.md
├── ARCHITECTURE.md
├── IMPLEMENTATION_PLAN.md
├── AGENTS.md
├── AI_HANDOFF.md
├── README.md
├── LICENSE
├── apps/
│   ├── web/
│   │   └── src/
│   └── api/
│       └── src/
├── packages/
│   └── shared/
├── db/
│   ├── schema/
│   └── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
└── docs/
    └── checkpoints/
```

`packages/shared` is only retained if shared API types/validation materially reduce duplication; otherwise keep the project simpler.

## 23. Environment variables

Server-only:

```text
DATABASE_URL=
SESSION_SECRET=
NIMIQ_RPC_URL=
NIMIQ_NETWORK=
ADMIN_WALLET_ADDRESSES=
SENTRY_DSN=   # optional
```

Potential public-safe build variables should be explicitly prefixed by the frontend build system and must contain no secrets.

No client bundle may contain database credentials, session secrets, admin configuration secrets, or private keys.

## 24. Phased implementation plan

Phase 0: repository reconnaissance.
Phase 1: foundation/environment.
Phase 2: database schema/migrations.
Phase 3: wallet auth.
Phase 4: marketplace discovery.
Phase 5: provider slot lifecycle.
Phase 6: atomic claims.
Phase 7: payment intent.
Phase 8: real NIM verification.
Phase 9: buyer/provider dashboards.
Phase 10: moderation/audit.
Phase 11: UX/accessibility hardening.
Phase 12: security pass.
Phase 13: full test/release candidate.
Phase 14: Nimiq Pay deployment verification.
Phase 15: submission readiness.

Each phase has a defined objective, dependencies, task boundary, tests, acceptance criteria, verification, Git checkpoint, and STOP condition in `IMPLEMENTATION_PLAN.md`.

## 25. PROJECT_SPEC.md

The actual file is included in this package and is the product source of truth.

## 26. ARCHITECTURE.md

The actual file is included in this package and fixes the stack, system boundaries, schema, APIs, security model, and UX architecture.

## 27. IMPLEMENTATION_PLAN.md

The actual file is included in this package and defines the one-phase-at-a-time implementation sequence.

## 28. AGENTS.md

The actual file is included in this package and governs the coding agent. It explicitly prohibits scope expansion and architecture drift.

## 29. AI_HANDOFF.md

The actual file is included in this package and sets the current state to Phase 0.

## 30. Final pre-implementation audit

Resolved before handoff:

- Product boundary narrowed from generic appointment transfer to provider-created released capacity.
- Payment source of truth moved to backend blockchain verification.
- Claim concurrency protected by DB locking and uniqueness.
- Payment replay explicitly prevented.
- Published commercial fields made immutable.
- Expired unpaid holds restore inventory exactly once.
- Payment verification timeout moves to manual review rather than silently releasing potentially paid inventory.
- No escrow/refund promise is made.
- AI removed from MVP.
- Admin surface kept minimal.
- No unnecessary queue/cache/search system required.
- Architecture fixed before coding.
- Agent ambiguity is constrained to implementation details that do not alter product/security behavior.

Remaining explicit implementation details (agent may decide within the fixed architecture): exact SDK wire encoding for signatures/transaction data, exact Nimiq RPC polling cadence, package versions compatible with the current official SDK, and routine component-level implementation choices.

## CODING AGENT START POINT

Give the coding agent exactly this instruction:

```text
Read PROJECT_SPEC.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, AGENTS.md, and AI_HANDOFF.md.

Implement Phase 0 — Repository reconnaissance ONLY.

Do not modify application code. Do not redesign the product. Do not change the architecture. Inspect the existing repository, dependencies, Nimiq SDK integration, entry points, environment/configuration, database/API scaffold, tests, and documentation. Compare the current state against the specification and report mismatches, reusable pieces, risks, and the exact files likely to change in Phase 1. Run existing lint/build/tests where practical and report actual results.

At the end, produce the checkpoint in AI_HANDOFF.md format, make the checkpoint commit `chore: baseline repository audit`, and STOP. Do not begin Phase 1.
```
