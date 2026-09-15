# Phase 14c Round 5 — Report: testnet RPC, display name, categories, date validation

Date: 2026-09-15. Status: **IMPLEMENTED, tested, deployed (Item 1 is
investigation-only, no code). No auth/session/CSRF/RPC/payment/auth-code
changes. No new dependency. No secrets printed. Temp probe scripts deleted.**

Baseline test counts: api 331 + web 117 + shared 1.

## 1. Item 1 — Nimiq testnet RPC (READ-ONLY, no code changed)

**Answer for the human:** set this ONE variable in the Railway dashboard
(`takeover-api` service → Variables; the service redeploys automatically):

```text
NIMIQ_RPC_URL=https://rpc.testnet.nimiqwatch.com/
```

Fallback if that host is down: `https://rpc-testnet.nimiqscan.com/`.
Do NOT change any code. Do NOT set `NIMIQ_NETWORK` (parsed but unread by
production code — informational only today).

### a) Public testnet RPC: yes, two of them

| Endpoint | Operator | Live proof (2026-09-15) |
|---|---|---|
| `https://rpc.testnet.nimiqwatch.com/` (RECOMMENDED — same operator as the current mainnet default `https://rpc.nimiqwatch.com`) | @sisou (Nimiq Watch; listed in `nimiq/awesome` as "Public RPC server. No uptime guarantees") | `getBlockNumber` → 200 `{"jsonrpc":"2.0","result":{"data":11485637,"metadata":null},"id":1}` |
| `https://rpc-testnet.nimiqscan.com/` (fallback) | NimiqScan ("Free public RPC · no API key · best-effort"; their docs page shows the same curl shape) | `getBlockNumber` → 200, head 11485638 (same chain, one block apart) |

Official JSON-RPC method reference: `https://nimiq.github.io/developer-center/build/rpc-docs/`
(positional params only — which is exactly what `apps/api/src/payments/rpc.ts` sends).

### b) `getTransactionByHash` shape: byte-identical contract

Bogus hash (`"00"*32`) against BOTH testnet endpoints returns HTTP 200 with:

```json
{"jsonrpc":"2.0","error":{"code":-32603,"message":"Internal error","data":"Transaction not found: 0000…0000"},"id":1}
```

This is byte-identical to the mainnet pattern pinned in `rpc.ts:8-9`.
The code's `isNotFoundError` matches on the phrase "transaction not
found" → maps to `null` → claim stays pending (never rejected, never
paid). The `getBlockNumber` envelope (`{"result":{"data":N,"metadata":null}}`)
is likewise identical to mainnet, which is the exact envelope
`rpcCall` unwraps (`body['result']['data']`).

Caveat (stated plainly): no REAL testnet transaction was demonstrated —
the 25 most recent testnet blocks were all empty (low testnet activity)
and aggressive block-walking tripped the endpoint's rate limiter (HTTP
429 `"Rate limit exceeded"` — same best-effort posture as the mainnet
public default). Residual risk is fail-closed by construction: any shape
deviation throws `RpcUnavailableError` → 503 `RPC_UNAVAILABLE` with no
state change; a payment can only reach `paid` on confirmations ≥ 3 plus
exact sender/recipient/amount/data match. The human's own testnet
payment is the final shape proof — worst case it sits in
`payment_pending`/lands in `payment_review`, it can never false-verify.

### c) Alternatives if no public endpoint existed

Not needed (two exist), recorded for completeness: self-host a
`core-rs-albatross` testnet node (the `nimiq-simple-faucet`
`deploy/compose` README documents the `local-node` profile against
`http://nimiq:8648`; official client config reference is
`core-rs-albatross` + the developer-center RPC docs above), or any
community Albatross node with the RPC server enabled.

### d) Testnet faucet (two wallets to fund)

```text
https://faucet.pos.nimiq-testnet.com
```

Probed 2026-09-15: HTTP 200 `"Nimiq Faucet"` (live). The alias
`https://faucet.nimiq-testnet.com/` serves the identical response.
Follow the on-page instructions to fund the buyer and provider wallets
(testnet NIM only; each needs the slot price + a little extra for fees).
Balance check: `https://test.nimiq.watch/`. (The `nimiq-simple-faucet`
project, updated 2026, cites this same faucet as "the public testnet
faucet" in its wallet-generation and QA docs.)

### e) Addresses + signatures: identical on testnet, zero changes needed

- Nimiq addresses are network-agnostic IBAN-style strings (`NQ` + check
  + base32 body). The same wallet string works on mainnet and testnet.
- `verifyNimiqSignature` (`apps/api/src/auth/nimiq-verify.ts:60-78`) is
  pure Ed25519 over the Hub envelope — no network, no RPC, no
  `networkId`, no secrets. `NIMIQ_NETWORK` is declared in `env.ts:10`
  but read NOWHERE in production code (only `.env.example`, the
  blueprint, the deployment doc, and `env.test.ts` mention it).
- The verification predicate (`toTxRecord`) never reads `networkId`.
- Conclusion: flip ONLY `NIMIQ_RPC_URL`. If anything behaves
  differently, STOP and report — per the brief, auth was NOT touched.

## 2. Item 2 — Display name not appearing (frontend-only bug, FIXED)

Root cause: the API was innocent. `toPublicSlot`
(`apps/api/src/slots/public-slot.ts:24,42`) includes `providerDisplay`,
resolved by `loadProviderDisplayMap`
(`provider-display.ts:24-46`, profile name preferred, truncated-wallet
fallback), and the web `PublicSlot` type already declared it
(`apps/web/src/lib/slots.ts:21`) — but NEITHER `SlotDetail.tsx` NOR
`SlotCard.tsx` rendered it. Present in the type, unused in the
components: exactly the hypothesized bug.

Live evidence (2026-09-15, before the fix):
`GET /api/v1/slots?limit=20` → 200, 2 rows, BOTH carry
`providerDisplay: "Udtyy"` (`hasField: true`). Format analysis: the
server fallback is always `first4…last4` (contains `…`); `"Udtyy"` has
no `…`, so it is a real profile display_name the human set during the
re-test — stored correctly, rendered nowhere. This also resolves the
round-2 Failure-3 mystery in passing (the PATCH worked; the display did
not).

Fix (2 lines): `By {slot.providerDisplay}` under the title in both
components — card: `text-xs text-slate-500`; detail: `text-sm
text-slate-500`. Neutral as-is presentation, no wallet/address jargon.
Also visible in `SellDetail` (reuses `SlotDetail`; public-safe by
design, no leak).

Tests: `apps
...[truncated 3880 chars]