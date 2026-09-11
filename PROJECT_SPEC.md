# TAKEOVER — Product & Engineering Specification

Status: Pre-implementation source of truth
Version: 1.0
Date: 2026-09-11

## 1. Product overview

**Product:** TAKEOVER

**One-line description:** TAKEOVER is a last-minute marketplace where providers publish released or otherwise unused scarce capacity and nearby customers can claim it immediately.

**Positioning:** The last-minute marketplace for released capacity.

**Supporting line:** Something valuable just became available. Claim it before it’s gone.

TAKEOVER is a consumer marketplace, not a crypto product. NIM is the payment rail because the Mini App must make Nimiq Pay a core part of the experience.

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

A provider has a slot available today/soon, publishes it, a buyer discovers it, places a short hold, pays in NIM through Nimiq Pay, and receives a confirmed claim.

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
- run escrow or custody funds;
- support fiat/card payments;
- support multiple chains/tokens in the MVP;
- provide ratings/reputation;
- use AI matching or recommendations;
- provide a native iOS/Android app;
- build complex messaging/chat;
- build an advanced provider CRM;
- perform automated fraud adjudication;
- allow buyer-side arbitrary price negotiation.

## 2. Product boundary decision

The MVP uses a **provider-created listing model**.

A person may publish a slot only when they are the provider/organizer or are authorized by that provider. The application does not verify that authorization automatically in the MVP. This is a product/legal boundary, not a technical claim. A report/admin workflow exists for abuse.

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
- NIM payment initiation through Nimiq Pay.
- Backend verification of the submitted NIM transaction.
- Transaction binding to the intended claim.
- Paid/confirmed claim state.
- Buyer “My Claims” view.
- Provider “My Slots” view.
- Admin report/disable capability.
- Audit events for security-sensitive actions.
- Responsive mobile-first UX.
- Public deployment over HTTPS.
- Production error handling and basic monitoring.
- Unit, integration, security, and E2E tests for critical paths.
- Public MIT-licensed repository for competition submission.

### SHOULD HAVE

- Optional provider verification badge managed by admin.
- Distance sorting using user-provided location/venue coordinates when available.
- Saved lightweight marketplace filters in local storage.
- Simple “share slot” URL.
- Basic user notification banners inside the app.
- Test/demo seed data tooling that is disabled in production.

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
- NIM + USDT support.
- Escrow/refund automation.
- Reputation and ratings.
- Push notifications.
- Multi-city/category expansion at scale.
- Native apps.
- Business subscriptions.

### OUT OF SCOPE FOR MVP

Anything not explicitly listed above is out of scope unless required to make a MUST HAVE work.

## 4. User roles

### Buyer

Can browse active public slots, view details, create a claim, initiate payment, submit a transaction hash, and view their own claim status/history.

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
- Paid/claimed slots are not shown as available.
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

### FR-05 Claim slot

Purpose: Reserve a slot for one buyer while payment is initiated.

Processing:
1. Lock the slot row in a DB transaction.
2. Re-check slot state and time.
3. Reject if no capacity remains.
4. Reject if buyer already has an active claim for the same slot.
5. Create claim.
6. Reserve the relevant capacity atomically.
7. Return claim ID and payment instructions.

Hold window: 10 minutes from claim creation when no transaction has been submitted.

After a transaction hash is submitted, the claim enters PAYMENT_PENDING and is held for up to 30 minutes while the backend verifies the transaction. If a hold expires before payment submission, its reserved quantity is returned atomically. If a submitted payment remains unverified after the pending window, the claim enters PAYMENT_REVIEW and the slot remains unavailable until an admin resolves it; the system must never silently release a claim that may have an on-chain payment associated with it.

Acceptance criteria:
- Two concurrent buyers cannot both reserve the final available unit.
- Duplicate claim requests for the same buyer/slot are idempotent or return the existing active claim.
- Expired holds are no longer claimable.

### FR-06 Pay and verify

Purpose: Complete a claim using NIM.

Rules:
- Backend generates/returns the exact payment intent: recipient wallet, exact amount, claim identifier, and transaction data payload requirements.
- Client initiates `sendBasicTransactionWithData()` through Nimiq Pay.
- Client submits the returned transaction identifier/hash to backend.
- Backend independently verifies the transaction on-chain.

The backend must verify, at minimum:
- transaction exists;
- transaction is confirmed/accepted according to the chosen Nimiq RPC verification semantics;
- sender address equals the buyer wallet on the claim;
- recipient address equals the provider payout address recorded in the payment intent;
- transferred amount equals the exact integer amount requested;
- transaction data matches the expected TAKEOVER claim binding;
- transaction has not already been attached to another successful payment.

Only then is the payment marked VERIFIED and the claim marked PAID/CONFIRMED.

Acceptance criteria:
- Client cannot set `paid=true`.
- A valid transaction can be submitted repeatedly without double-settling.
- A transaction for another claim is rejected.
- Incorrect amount/recipient/sender/data is rejected.

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

## 6. Acceptance baseline

The MVP is complete only when a clean user can:

1. Open the Mini App.
2. Connect/authenticate with a Nimiq wallet.
3. Browse a seeded or provider-created active slot.
4. View all commercial details.
5. Claim an available slot.
6. Initiate NIM payment through Nimiq Pay.
7. Have the backend verify the real transaction.
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
- Escrow (not implemented)

A small payment disclosure may say: “Pay with NIM through Nimiq Pay.”

## 8. Source and competition constraints

Current official competition rules require a working Mini App built on the Nimiq Pay Mini Apps Framework, a public GitHub repository under MIT, no hardcoded secrets, and meaningful support for NIM or USDT. A focused polished app is explicitly preferred over a large unfinished app.

This specification intentionally optimizes for those constraints while preserving a normal consumer product identity.
