# TAKEOVER — Implementation Plan

Status: Pre-implementation
Method: Proper Vibe Coding Workflow
Version: 1.0

## Operating rule

Implement **one phase only** per coding-agent instruction.

For each phase:

`IMPLEMENT -> TEST -> INSPECT -> FIX -> COMMIT -> CHECKPOINT -> STOP`

The agent must not continue into the next phase automatically.

Every phase is independently verifiable and ends at a Git checkpoint.

## Phase 0 — Repository reconnaissance

Objective: Understand the existing starter repository without modifying it.

Dependencies: Existing repository/starter archive.

Tasks:
- Inspect package.json.
- Inspect src structure.
- Inspect existing Nimiq SDK integration.
- Inspect environment/config files.
- Identify current routes/components.
- Identify existing local API scaffold.
- Document dependency versions and risks.
- Compare current code with PROJECT_SPEC.md and ARCHITECTURE.md.

Files/components expected:
- No production code changes required.
- Optional `docs/repo-audit.md` report only if useful.

Database/API/UI changes: None.

Tests: Existing tests/build/lint only.

Acceptance criteria:
- Agent can describe current architecture accurately.
- No unrelated changes.
- No architecture changes.

Verification:
- `npm install` or package-manager equivalent if needed.
- `npm run lint`
- `npm run build`
- existing tests.

Git checkpoint: `chore: baseline repository audit`

STOP.

## Phase 1 — Foundation and environment

Objective: Make the fixed frontend/backend/database architecture boot cleanly.

Dependencies: Phase 0.

Tasks:
- Add/confirm Fastify backend workspace.
- Add TypeScript shared config where appropriate.
- Add environment validation.
- Add Zod.
- Add Drizzle and PostgreSQL connection.
- Add basic health endpoint.
- Configure dev scripts.
- Ensure Nimiq SDK integration remains intact.

Expected files:
- `apps/web` or equivalent frontend structure
- `apps/api` or equivalent backend structure
- `packages/shared` only if genuinely useful; do not create unnecessary monorepo layers
- env validation module
- DB client/config

Database:
- connection only; no domain tables yet.

API:
- `GET /health`

UI:
- Preserve existing starter UI; no redesign.

Tests:
- env validation
- health endpoint
- DB connection smoke test

Acceptance:
- Frontend builds.
- Backend starts.
- Health endpoint returns 200.
- Database connection can be established locally.

Verification:
- lint/build/tests plus manual browser load.

Git checkpoint: `feat: establish application foundation`

STOP.

## Phase 2 — Database schema and migrations

Objective: Create the complete MVP relational model.

Dependencies: Phase 1.

Tasks:
- Implement users.
- sessions.
- auth_challenges.
- provider_profiles.
- slots.
- claims.
- payment_intents.
- reports.
- audit_events.
- Add constraints/indexes/foreign keys.
- Add migration scripts.

Tests:
- migration up/down where supported
- constraint tests
- unique claim tests

Acceptance:
- Clean database can migrate from zero.
- Invalid states are prevented where possible by constraints.
- No domain logic depends on absent columns.

Git checkpoint: `feat: add takeover database schema`

STOP.

## Phase 3 — Wallet authentication

Objective: Implement secure wallet-based identity and sessions.

Dependencies: Phase 2.

Tasks:
- challenge creation endpoint
- Nimiq signature verification
- session creation
- logout
- current user endpoint
- auth middleware
- disabled-user enforcement

Tests:
- valid challenge/signature
- invalid signature
- expired challenge
- replayed challenge
- wallet mismatch
- session expiration/revocation

Acceptance:
- Only a valid signature authenticates a wallet.
- No client-provided address can impersonate another address.

Git checkpoint: `feat: add wallet authentication`

STOP.

## Phase 4 — Marketplace read path

Objective: Make active supply discoverable.

Dependencies: Phase 3.

Tasks:
- slot public read service
- filtering
- sorting
- pagination
- slot detail endpoint
- public/private field serializer

UI:
- marketplace home
- filters
- slot cards
- slot detail shell

Tests:
- expired/cancelled exclusion
- pagination
- filters
- privacy serialization

Acceptance:
- A user can browse real DB-backed slots.
- No unpublished/private slot data leaks.

Git checkpoint: `feat: add marketplace discovery`

STOP.

## Phase 5 — Provider slot creation and lifecycle

Objective: Providers can create and publish supply.

Dependencies: Phase 4.

Tasks:
- provider profile creation/update
- create slot
- draft edit
- publish
- cancel unpaid slot
- owner authorization
- lifecycle service/state transitions

UI:
- Sell flow
- My Slots
- manage slot

Tests:
- validation
- ownership
- publish requirements
- immutable commercial fields after publish
- cancellation restrictions

Acceptance:
- Provider can publish a valid slot.
- Another provider cannot modify it.

Git checkpoint: `feat: add provider slot lifecycle`

STOP.

## Phase 6 — Claims and concurrency

Objective: Implement the scarce-inventory reservation system safely.

Dependencies: Phase 5.

Tasks:
- create claim endpoint
- row-lock/transaction logic
- idempotent hold-expiry resolver that restores reserved quantity exactly once
- duplicate active-claim prevention
- hold expiry handling
- quantity decrement/increment recovery where allowed
- claim detail endpoint

UI:
- Claim button
- hold countdown
- claim status page

Tests:
- one buyer claims final unit
- expired hold restores one unit exactly once
- concurrent two-buyer race
- duplicate requests
- expired claim
- disabled user
- sold-out slot

Acceptance:
- It is impossible for two concurrent transactions to reserve the same final unit.
- Expired holds do not remain active.

Git checkpoint: `feat: add atomic slot claims`

STOP.

## Phase 7 — NIM payment intent

Objective: Generate authoritative payment instructions for a claim.

Dependencies: Phase 6.

Tasks:
- payment intent creation
- exact amount/recipient/data derivation
- NIM amount conversion utility
- idempotency handling
- payment screen UI

Tests:
- one intent per claim
- exact integer amount
- recipient comes from server
- transaction data binding

Acceptance:
- User sees an exact payment request that is generated from server state.

Git checkpoint: `feat: add NIM payment intents`

STOP.

## Phase 8 — Real NIM payment verification

Objective: Verify actual blockchain payment before changing claim state.

Dependencies: Phase 7.

Tasks:
- transaction hash validation
- Nimiq RPC/read client
- sender verification
- recipient verification
- amount verification
- data verification
- confirmation/finality policy
- replay prevention
- idempotent verification
- safe error handling

UI:
- payment submission state
- verifying state
- failed verification state
- confirmed state

Tests:
- valid tx
- wrong sender
- wrong recipient
- wrong amount
- wrong data
- unknown tx
- replayed tx
- repeated verification
- RPC outage

Acceptance:
- Only a valid real transaction changes claim to PAID.
- UI never declares success before backend verification.

Git checkpoint: `feat: add verified NIM payments`

STOP.

## Phase 9 — Buyer/provider dashboards

Objective: Make the marketplace usable after a transaction.

Dependencies: Phase 8.

Tasks:
- My Claims
- My Slots
- claim history
- provider payment state
- responsive navigation

Tests:
- ownership isolation
- state rendering

Acceptance:
- Buyer and provider can independently see the correct state.

Git checkpoint: `feat: add buyer and provider dashboards`

STOP.

## Phase 10 — Moderation and audit

Objective: Add the minimum operational controls required for abuse handling.

Dependencies: Phase 9.

Tasks:
- report endpoint
- admin auth guard
- report list
- disable listing
- disable user
- audit event generation

Tests:
- non-admin denial
- owner/admin permissions
- audit event creation

Acceptance:
- Admin can contain a reported listing/user without database direct access.

Git checkpoint: `feat: add moderation and audit controls`

STOP.

## Phase 11 — UX hardening and accessibility

Objective: Polish the MVP without adding features.

Dependencies: Phase 10.

Tasks:
- loading/empty/error states
- form validation presentation
- payment status clarity
- responsive behavior
- focus states
- touch targets
- accessibility labels
- copy refinement
- remove crypto jargon from non-payment contexts

Tests:
- keyboard navigation
- mobile viewport smoke tests
- critical route rendering

Acceptance:
- Core journey is understandable on first use.

Git checkpoint: `feat: polish takeover ux`

STOP.

## Phase 12 — Security pass

Objective: Attack the implemented application before release.

Dependencies: Phase 11.

Tasks:
- inspect authentication
- inspect authorization/IDOR
- inspect validation
- inspect rate limits
- inspect secret handling
- inspect CSRF/session behavior
- inspect payment replay
- inspect race conditions
- inspect admin routes
- inspect logs for secret leakage

Do not mix feature work into this phase.

Tests:
- malicious ID substitution
- forged role
- duplicate claim race
- replayed tx hash
- malformed payloads
- rate-limit behavior

Acceptance:
- Findings are documented and fixed where accepted.

Git checkpoint: `security: harden takeover MVP`

STOP.

## Phase 13 — Full test and release candidate

Objective: Demonstrate end-to-end readiness.

Dependencies: Phase 12.

Tasks:
- unit suite
- integration suite
- E2E happy path
- E2E concurrent claim scenario
- E2E payment verification
- production build
- environment verification
- deployment smoke tests

Acceptance:
- All critical tests pass.
- No known P0/P1 security issue remains.

Git checkpoint: `release: takeover MVP candidate`

STOP.

## Phase 14 — Nimiq Pay deployment verification

Objective: Validate the actual Mini App inside Nimiq Pay.

Dependencies: Phase 13.

Tasks:
- test production URL inside Nimiq Pay
- verify wallet access
- verify real NIM transaction path
- verify mobile layout
- verify reload/session behavior
- verify public accessibility

Acceptance:
- Clean user can complete the core loop inside Nimiq Pay without manual developer intervention.

Git checkpoint: `release: verify nimiq pay integration`

STOP.

## Phase 15 — Submission readiness

Objective: Prepare competition submission without adding product scope.

Dependencies: Phase 14.

Tasks:
- verify public GitHub repo
- verify MIT license
- remove secrets/test credentials
- write 250-word submission description
- record demo walkthrough if used
- final README
- document known limitations

Acceptance:
- Repository and deployment satisfy current official competition constraints.

Git checkpoint: `docs: prepare competition submission`

STOP.

## Checkpoint template

```text
CURRENT PHASE:
COMPLETED:
TESTS RUN:
RESULT:
KNOWN ISSUES:
SECURITY NOTES:
FILES CHANGED:
GIT COMMIT:
NEXT TASK:
BLOCKED BY:
```

## Agent task granularity rule

Never ask the agent to implement multiple unverified phases.

The prompt should name one phase, its exact acceptance criteria, and the explicit STOP condition.

## Current first task

Implement **Phase 0 only: Repository reconnaissance**. Do not modify application code.
