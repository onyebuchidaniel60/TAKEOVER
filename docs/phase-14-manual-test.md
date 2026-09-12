# Phase 14b — Manual Nimiq Pay Round-Trip Script (human, real device)

Preconditions: Phase 14a resume (§8 of `docs/phase-14-deployment.md`) is done. You have the
Vercel URL and the backend allows it in `CORS_ORIGINS`. This script uses mainnet NIM —
testnet payments will NOT verify (backend checks mainnet RPC). All quoted copy below is the
actual app copy as of Phase 14a; if the app shows anything else, stop and record it verbatim.

- Vercel URL: `https://takeover-web-gamma.vercel.app` (production alias, deployed 2026-09-12)
- Backend: `https://takeover-api-production-1511.up.railway.app`
- Price under test: 1 NIM. Each wallet needs > 1 NIM plus a little extra for fees.

## Reaching the app in Nimiq Pay

On the phone: open **Nimiq Pay** → **Mini Apps** → enter the Vercel URL in the **Custom URL**
field. (Alternatives: `nimiqpay://miniapp?url=<host>` deeplink, or
`https://nimpay.app/miniapps/open/<host>`.) If Nimiq Pay warns the URL was never accessed
before, accept and continue.

## Round-trip

1. On device A, open the TAKEOVER Mini App via the Custom URL field above (`https://takeover-web-gamma.vercel.app`).
2. In the top bar press **Connect Wallet** and approve Wallet A in the native dialog.
3. Open **/profile** (top bar). Confirm it shows Wallet A's truncated address with tap-to-copy.
4. Go to **/sell/new**. Fill every field:
   - Title: `Phase 14 test slot`
   - Description: any short text
   - Category: any (e.g. `dining`)
   - Area: any (e.g. `Mitte`)
   - Starts: 24h from now (datetime picker)
   - Ends: 1h after Starts
   - Price (NIM): `1`
   - Spots: `1`
   - Payout wallet: Wallet A's full address (placeholder reads `NQ…`; note under the field
     reads "Buyers pay this address directly.")
   Press **Save draft**. You land on **/sell/:slotId**.
5. On **/sell/:slotId** press **Publish**. Badge becomes `Published`.
6. On **/profile** press **Log out**. On device B (or after clearing the app's cookies/data and
   reopening via the Custom URL), continue.
7. Press **Connect Wallet** and approve Wallet B.
8. Open the feed at **/**. Confirm the card `Phase 14 test slot` appears.
9. Open the slot (`/slot/:slotId`). Confirm visible: title, **When**, **Where**, **Price**
   (`1 NIM`), **Spots left** (`1 of 1`).
10. Press **Claim this opening**. You land on **/claim/:claimId**: badge **On hold** plus
    countdown **Hold expires in M:SS**.
11. Press **Pay with Nimiq Pay**. (The panel first shows `1 NIM` and `To <Wallet A address>` —
    confirm both BEFORE approving.)
12. Confirm the Nimiq Pay native prompt shows: Recipient = Wallet A's payout address,
    Amount = 1 NIM, Data (if visible) = `TAKEOVER:v1:<claimId>` (the `<claimId>` is the UUID in
    the `/claim/:claimId` address bar).
13. Approve in Nimiq Pay.
14. Confirm the claim page badge becomes **Awaiting confirmation** with box text
    **Checking payment status…** then **Awaiting confirmation.** (NOT "Payment submitted…".)
    A **Check status** button is always present; the recorded tx hash is shown below.
15. Wait. Confirm the badge becomes **Paid** with box text **Paid.** (NOT "Payment verified".)
    Expected within ~30 seconds on mainnet (polls every 5s, up to 60 attempts).
16. As Wallet A: open **/sell/:slotId** (same id as step 4). Confirm the claims section shows
    one paid claim (NOT at `/sell/:slotId/claims` — that route does not exist).
17. In Nimiq Pay as Wallet A, confirm the balance increased by ~1 NIM minus network fees.
18. If an admin wallet is configured: as the admin wallet, open **/admin/audit** and confirm the
    journey's events (`user.created`, `slot.published`, `claim.created`, `payment.submitted`,
    `payment.verified`) are present.

## Troubleshooting tree (record actual values, do not work around)

**A. Cookie dropped in the Nimiq Pay WebView.**
Symptoms: `/me` returns 401 immediately after connect (app bounces to `/` / shows connect hint).
Verify: rebuild the frontend with `VITE_DEBUG_PAYMENTS=true`, reload in Nimiq Pay with dev tools
if available; inspect the login response for the `Set-Cookie` header and whether later requests
send `Cookie`. Also check Railway logs for the requestId of the 401.
Document: whether `Set-Cookie` arrived and whether `Cookie` was sent back.
Workaround (documented, NOT implemented unless observed): Bearer token via `Authorization` header.

**B. SDK returns something other than a 64-hex hash.**
Symptoms: submission fails validation, or verify never resolves.
Verify: with `VITE_DEBUG_PAYMENTS=true`, capture the exact `sendBasicTransactionWithData
returned` console value.
Document: the actual value verbatim (length, charset, prefix).

**C. SDK transforms the data field.**
Symptoms: verify returns review (`data_mismatch` → badge **Payment under review**,
box **Payment under review. We'll be in touch.**).
Verify: look the tx hash up in a Nimiq explorer, inspect the data field, compare byte-for-byte
to `TAKEOVER:v1:<claimId>`; compare with the `calling sendBasicTransactionWithData` console value.
Document: the actual on-chain data payload.

**D. Origin header from Nimiq Pay does not match CORS_ORIGINS.**
Symptoms: 403 `FORBIDDEN_ORIGIN` on the first authenticated request (claim attempt fails).
Verify: with `VITE_DEBUG_PAYMENTS=true` capture request headers, or take the requestId from the
403 envelope and find the rejected Origin in Railway logs.
Document: the actual Origin value. Do NOT add it to `CORS_ORIGINS` without an explicit decision —
report it first.
