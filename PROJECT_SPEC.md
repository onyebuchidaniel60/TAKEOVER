# TAKEOVER — Product & Engineering Specification

Status: Pre-implementation source of truth
Version: 1.0
Date: 2026-09-11

## 1. Product overview

**Product:** TAKEOVER

**One-line description:** TAKEOVER is a last-minute marketplace where providers publish released or otherwise unused scarce capacity and nearby customers can claim it immediately.

TAKEOVER supports USDT on Polygon for escrowed payments. Funds are held in a non-custodial escrow smart contract on Polygon and released on delivery confirmation. The backend never custodies funds.

**Positioning:** The last-minute marketplace for released capacity.

**Supporting line:** Something valuable just became available. Claim it before it’s gone.

TAKEOVER is a consumer marketplace, not a crypto product. Nimiq Pay is the wallet and identity layer because the Mini App must make Nimiq Pay a core part of the experience. NIM is retained in the product as a future platform listing fee (separate phase, not built here).

### Problem

Businesses and organizers regularly have scarce capacity that becomes available too late to sell through normal channels: an empty restaurant table, a class seat, a sports court, a service appointment, or another bookable slot. Buyers who need something urgently have the opposite problem: they often cannot discover last-minute availability without calling, browsing multiple sites, or repeatedly checking.

TAKEOVER connects those two moments.

### Current alternatives / workarounds

- Provider manually calls/texts a waitlist or posts on social media.
- Customer calls businesses one by one.
- Customer repeatedly refreshes the provider’s normal booking page.
- Broad marketplace/listing products that do not specialize in immediate scarcity.
- Informal resale/transfers, where applicable.

### Target users

**Primary buyer:** A person looking for a useful service/experience at short notice.

**Primary supply user:** A provider or organizer who is authorized to sell/reallocate a slot they control.

### Roles

1. Buyer
2. Provider
3. Admin/operator

A single wallet identity can act as both Buyer and Provider. There is no separate account type required for the MVP.

### Core value proposition

Providers turn otherwise-idle capacity into a sale. Buyers discover real, time-sensitive availability without manually searching everywhere.

### Key differentiator

TAKEOVER is organized around **scarce capacity that is available now or soon**, rather than around a broad directory of businesses. The product experience emphasizes urgency, exact time, location, price, and simple claiming.

### Primary use case

A provider has a slot available today/soon, publishes it, a buyer discovers it, places a short hold, pays USDT through the escrow flow, and receives a confirmed claim.

### Secondary use cases

- Restaurant/table availability
- Fitness/class seats
- Sports court availability
- Salon/barber/service appointment slots
- Local service openings
- Event seats where the organizer is authorized to sell the released seat

### Explicit non-goals

TAKEOVER MVP does **not**:

- become a full booking/calendar SaaS for providers;
- scrape third-party booking systems;
- let arbitrary users list reservations they do not control;
- guarantee that an underlying external reservation exists;
- provide automatic appointment-transfer integrations;
- support fiat/card payments;
- provide ratings/reputation;
- use AI matching or recommendations;
- provide a native iOS/Android app;
- build complex messaging/chat;
- build an advanced provider CRM;
- perform automated fraud adjudication;
- allow buyer-side arbitrary price negotiation.

## 2. Product boundary decision

The MVP uses a **provider-created listing model**.

Payment is escrowed. A buyer's funds are held in escrow until the provider marks the service delivered and the buyer confirms receipt, or the dispute window expires without dispute, or an admin resolves a dispute. USDT is escrowed by a smart contract on Polygon; the backend never holds USDT. Supply remains self-attested: escrow protects payment, not the existence of the underlying reservation.

The future concept of a customer transferring an existing booking is explicitly deferred because transfer rights and provider-system verification create a materially larger product and legal surface.

## 3. MVP scope

### MUST HAVE

- Nimiq Pay Mini App compatibility.
- Wallet-based identity.
- Marketplace feed of active slots.
- Basic category and location/time filtering.
- Provider creation of a slot.
- Provider editing/canceling an unpublished or unpaid slot.
- Slot detail page.
- Buyer claim/hold flow.
- Exact claim expiration before payment starts.
- Transaction binding to the intended claim.
- Escrow-funded / confirmed claim state.
- Buyer “My Claims” view.
- Provider “My Slots” view.
- Admin report/disable capability.
- Audit events for security-sensitive actions.
- Responsive mobile-first UX.
- Public deployment over HTTPS.
- Production error handling and basic monitoring.
- Unit, integration, security, and E2E tests for critical paths.
- Public MIT-licensed repository for competition submission.
- Smart contract escrow for USDT payments (Polygon)

### SHOULD HAVE

- Optional provider verification badge managed by admin.
- Distance sorting using user-provided location/venue coordinates when available.
- Saved lightweight marketplace filters in local storage.
- Simple “share slot” URL.
- Basic user notification banners inside the app.
- Test/demo seed data tooling that is disabled in production.
- One-way provider contact note visible to the buyer once the claim's
  escrow is funded (FR-13).

### NICE TO HAVE

- PWA metadata/icons.
- Better map/location presentation.
- Basic waitlist/intention capture.
- Provider analytics such as views-to-claims.

### FUTURE

- Consumer-originated reservation release.
- Provider calendar integrations.
- Automatic provider availability synchronization.
- AI matching/recommendations.
- Dynamic pricing suggestions.
- Reputation and ratings.
- Push notifications.
- Multi-city/category expansion at scale.
- Native apps.
- Business subscriptions.

### OUT OF SCOPE FOR MVP

Anything not explicitly listed above is out of scope unless required to make a MUST HAVE work.

## 4. User roles

### Buyer

Can browse active public slots, view details, create a claim, create an escrow intent, submit the deposit reference, confirm receipt, and dispute within the window, and view their own claim status/history.

Cannot edit another user’s slot, change a slot price, mark a payment verified, cancel another user’s claim, or access private provider/admin data.

### Provider

Any authenticated wallet user may create a listing, subject to marketplace policy. Provider permissions are scoped to their own listings.

Can create, edit, publish, cancel, and view their own slots; view claims for their own slots; and see payment status after backend verification.

Cannot access another provider’s unpublished information, modify paid claims, or manually mark payments verified.

### Admin

Admin is an allowlisted server-side role assigned explicitly. Admin access is separate from normal wallet ownership.

Can view reports, users, listings, claims, payments, audit events, and disable a listing/user for abuse. Admin actions are always audited.

## 5. Functional requirements

### FR-01 Wallet identity

Purpose: Establish the authenticated user identity from Nimiq Pay.

Actor: Buyer/Provider/Admin.

Preconditions: App is running inside Nimiq Pay and the user has a Nimiq wallet account available.

Inputs: Wallet account/address and signed authentication challenge.

Processing: Server creates a nonce, client requests a wallet signature through the Nimiq provider, server verifies it, then creates/loads the user and server session.

Output: Authenticated session tied to the verified wallet address.

Validation: Nonce must be unexpired, single-use, and bound to the claimed wallet address.

Acceptance criteria:
- Unauthenticated user can request a challenge.
- Valid signature creates a session.
- Replaying the same challenge fails.
- Changing the wallet address after the challenge causes verification failure.
- Server never trusts a client-only wallet address claim.

### FR-02 Browse marketplace

Purpose: Discover available capacity.

Inputs: category, date/time window, location text, sort.

Processing: Return only publishable, non-expired, non-cancelled slots whose capacity remains available.

Acceptance criteria:
- Expired/cancelled slots never appear as claimable.
- Escrow-funded or otherwise unavailable slots are not shown as available.
- Public responses do not expose seller-only data.

### FR-03 Create slot

Purpose: Let an authorized provider publish supply.

Required fields:
- title
- category
- description
- venue/business name
- venue address
- start_at
- end_at
- capacity
- price_nim
- optional image URL
- provider contact/display name

Business rules:
- start_at must be in the future.
- end_at must be after start_at.
- slot must not exceed configured maximum duration.
- price must be positive and use integer base units internally.
- capacity must be positive and within configured maximum.
- provider can only modify their own unpublished/unpaid slots.

Acceptance criteria:
- Valid listing is created as DRAFT or PUBLISHED according to UI path.
- Invalid dates/prices/capacity are rejected server-side.
- A provider cannot create a listing owned by another user.

### FR-04 Publish slot

Purpose: Make a provider slot publicly claimable.

Rules:
- Only owner can publish.
- Required fields must be complete.
- start_at must still be in the future.
- publication creates immutable commercial fields for the active lifecycle: provider, price, capacity, start/end times.
- When the NIM listing fee is configured (`LISTING_FEE_NIM` +
  `TAKEOVER_FEE_WALLET_ADDRESS`), publishing requires payment of the fee:
  the seller pays the exact NIM amount via Nimiq Pay with the binding
  `TAKEOVER:fee:v1:<slotId>`, and the backend verifies the on-chain transfer
  (sender, recipient, amount, data, confirmations, replay) before the slot
  flips to published. The fee wallet only receives; there is no custody.

### FR-05 Claim slot

Purpose: Reserve a slot for one buyer while the buyer prepares the escrow deposit.

Processing:
1. Lock the slot row in a DB transaction.
2. Re-check slot state and time.
3. Reject if no capacity remains.
4. Reject if buyer already has an active claim for the same slot.
5. Create claim in `active_hold`.
6. Reserve the relevant capacity atomically.
7. Return claim ID and payment instructions.

Hold window: 10 minutes from claim creation. If the hold expires before a deposit is verified, its reserved quantity is returned atomically.

Everything from escrow intent onward (deposit, deposit verification, delivery, release, refund, disputes) is owned by FR-06 and FR-12, not by this requirement.

Acceptance criteria:
- Two concurrent buyers cannot both reserve the final available unit.
- Duplicate claim requests for the same buyer/slot are idempotent or return the existing active claim.
- Expired holds are no longer claimable.

### FR-06 Pay and verify (USDT escrow)

Purpose: Complete a claim using USDT, with funds held in escrow until a release condition is met.

USDT path (non-custodial):
- Backend returns the escrow contract address, USDT amount, and approval instructions.
- Buyer approves the escrow contract to spend the exact amount, then deposits USDT into the contract.
- Backend verifies the on-chain Deposited event from the contract.
- Contract holds the funds; release and refund are contract functions.
- Backend never custodies USDT.

Escrow lifecycle:
- Buyer deposits; claim moves to escrow_funded.
- Provider marks service delivered; claim moves to delivered.
- Buyer confirms receipt -> funds release to provider.
- Buyer disputes within the window -> disputed; admin resolves.
- Dispute window expires without action -> funds release to provider.
- Provider never marks delivered before the delivery deadline -> funds refund to buyer.

Acceptance criteria:
- Client cannot set release or refund directly.
- Same deposit cannot fund two claims.
- Same release cannot settle two escrows.
- Funds release to the provider only on confirmed delivery or timeout.
- Funds refund to the buyer only on delivery timeout or admin resolution.
- USDT escrow is enforced on-chain by the escrow contract.

2026-09-17 decision: NIM custodial escrow retired (14f-r). Rationale: custodial escrow infrastructure — backend wallet custody, double-entry ledger reconciliation, invariant enforcement, KMS handling — is not justified for the MVP demo. The non-custodial USDT rail covers the escrow need fully. NIM remains part of the product as a small platform listing fee (separate, future phase — NOT built here).

### FR-07 My Claims

Buyer sees active, paid, expired, and canceled claims for their own wallet identity only.

### FR-08 My Slots

Provider sees listings they own and current lifecycle/payment outcomes. Provider never gets raw private buyer authentication material.

### FR-09 Cancel slot

Provider can cancel their own slot while it has no verified paid claim.

Once any claim is PAID, cancellation through the standard provider UI is disabled in MVP. Admin may suspend the listing for abuse; no automated refund is promised.

### FR-10 Report

Authenticated users can report a slot or provider for abuse. Minimal report categories: misleading listing, unauthorized listing, prohibited content, payment issue, other.

### FR-11 Admin moderation

Admin can disable users/listings and mark reports resolved. Admin actions generate immutable audit events.

### FR-12 Escrow lifecycle

USDT on Polygon is the only escrow rail. The NIM custodial escrow rail described in earlier revisions was retired (14f-r, 2026-09-17). The lifecycle states below remain token-agnostic in the schema; only the USDT path is implemented.

Purpose: Hold buyer funds and release them per the delivery condition.

Escrow states: escrow_funded, delivered, disputed, released, refunded.

Transitions:
  escrow_funded -> delivered       (provider marks delivered)
  delivered     -> released        (buyer confirms OR window expires)
  delivered     -> disputed        (buyer disputes within window)
  disputed      -> released        (admin rules for provider)
  disputed      -> refunded        (admin rules for buyer)
  escrow_funded -> refunded        (delivery deadline expires)

Authority:
  USDT: the on-chain escrow contract is the source of truth.

Every fund movement writes an audit event. USDT movements are on-chain events mirrored by the backend.

### FR-13 Post-funding provider contact details

Purpose: Give the buyer one-way provider contact details without opening a
pre-payment solicitation channel (chat/messaging is declined).

The provider sets a free-form contact note on their slot (1–500 characters,
no URLs). The note is visible to the buyer only when the claim's escrow is
funded, delivered, disputed, releasing, or released; it stays hidden while
the escrow is created, refunding, or refunded, and when the claim has no
escrow at all.

## 6. Acceptance baseline

The MVP is complete only when a clean user can:

1. Open the Mini App.
2. Connect/authenticate with a Nimiq wallet.
3. Browse a seeded or provider-created active slot.
4. View all commercial details.
5. Claim an available slot.
6. Initiate payment (USDT) through the escrow flow.
7. Have the backend verify the real transaction.
7a. See their funds held in escrow (on-chain for USDT).
7b. As the provider, mark the service delivered.
7c. As the buyer, confirm receipt and see funds release to the provider.
7d. In a second flow, have the provider not mark delivery, let the delivery deadline pass, and see an automatic refund.
8. See the claim become confirmed.
9. See the provider see the corresponding paid state.
10. Fail safely when another buyer claims the slot first.
11. Fail safely when payment data is altered or replayed.
12. Navigate without exposing another user's private resources.

## 7. Product language

Use consumer language. Do not lead with blockchain terminology.

Preferred terms:
- Slot
- Available now
- Claim
- Hold
- Confirmed
- Provider
- Price
- Tonight / Today / Soon

Avoid in primary UX:
- Gas
- Blockchain explorer
- Smart contract
- Crypto marketplace

A small payment disclosure may say: “Pay with NIM through Nimiq Pay.”

## 8. Source and competition constraints

Current official competition rules require a working Mini App built on the Nimiq Pay Mini Apps Framework, a public GitHub repository under MIT, no hardcoded secrets, and meaningful support for NIM or USDT. A focused polished app is explicitly preferred over a large unfinished app.

This specification intentionally optimizes for those constraints while preserving a normal consumer product identity.
