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

Tests: `apps/web/test/provider-display.test.tsx` (new, 4 tests):
card/detail × profile-name/fallback, including a no-jargon assertion
(the rendered line never matches /wallet|address/i).

## 3. Item 3 — Category dropdown (UX, FIXED)

`SLOT_CATEGORIES` (exact six, `as const`) lives in
`apps/web/src/lib/slots.ts` (logic out of UI, per the coding rules).
`SearchFilters.tsx`: category text input becomes a `<select>` with
`All categories` (`value=""`) + the six. `values`/`onChange`/URL-param
behavior unchanged (`Home.tsx` untouched — empty still drops the
param). `SlotForm.tsx`: category becomes a `<select>` with `No
category` + the six + a conditional disabled `Custom: <value>` option
when the draft value is non-empty and off-list (shows instead of
crashing/blanking; submits unchanged via the existing
`trim() || undefined` mapping; picking a list value replaces it).
Server accepts any string (unchanged — UX layer only). One-line
`docs/phase-14-manual-test.md` fix: the script's `Category: any (e.g.
dining)` example is no longer selectable → now `pick one from the
dropdown (e.g. Restaurant / food)`.

Tests: `apps/web/test/slot-categories.test.tsx` (new, 7 tests):
filter exact-six + All; `onChange` emits the pick; feed round-trip
(`?category=Event` renders selected, fetch carries it, change to Other
refetches with Other); form exact-six + No category; submit sends the
pick; custom `dining` renders disabled `Custom: dining`, submits
`dining` untouched, and is replaceable with `Event`.

Known edge (deliberate, reported): a non-list value in the filter URL
(e.g. `?category=dining`) shows a blank select while the URL param
still drives filtering (server exact-match). The brief prescribed no
custom handling for the filter; stored data converges to the list over
time.
## 4. Item 4 — Client-side date validation (already implemented, VERIFIED)

No production change needed: round 3 (Fix C2) already added
`validateSlotStartsAt` (strictly future, `Start must be in the
future.`) and `validateSlotEndsAt` (strictly after start, `End must be
after the start.`) in `lib/slots.ts` plus submit-time wiring with
inline `FieldMessage` errors on the start/end fields in `SlotForm.tsx`
— exactly the prescribed Option A. Server validation and publish
semantics untouched. Coverage: cases (a)/(b)/(d) by the existing
round-3 form test + the `request-bodies.test.ts` validator matrix;
added the missing case (c) — `form-validation.test.tsx` →
`submits a valid future start with no end and omits ends_at`
(submits once, no `ends_at` key in the body).
Note: drafts with past starts (e.g. the human's "Table for ten") must
have their date updated to save — expected, no exemption added.

## 5. Live deploy evidence (2026-09-15)

- Commit `4381194` pushed `c181faa..4381194` to `origin/main`
  (follow-up docs commit `c553048` records the evidence below).
- Railway: push auto-deploys. No backend code changed this round, so
  any green build serves the `providerDisplay` contract; target probe
  live: `GET /health` → 200, `GET /api/v1/slots?limit=5` → 200 with
  `providerDisplay` on both rows.
- Vercel: `--dry` clean (217 files, 16 ignored — `.env.txt` and all
  `dist/` excluded). Deploy `dpl_DXfpvTvMyGLVxqXBESkiGyynXjbV`
  (`https://takeover-f35j2cnlp-uhhh2.vercel.app`), READY, production
  target. Alias `takeover-web-gamma.vercel.app` re-pointed, NOT
  shifted → no `CORS_ORIGINS` change needed.
- Alias bundle proof (entry chunk alone is not enough — route chunks
  load lazily): entry `assets/index-DHJvbiil.js` references
  `Home-BvAel_El.js` (contains `All categories`),
  `slots-DZlCZHUP.js` (contains `Restaurant / food`),
  `SlotForm-BjjWfC7b.js` (contains `No category` + `Custom:`), and
  `SlotDetail-Dmoa_LsK.js` (contains `providerDisplay`).
- Note: the direct deployment URL returns a Vercel
  Deployment-Protection gate page, not the app — the production alias
  is unaffected and is the only supported surface.
- Post-deploy checks: `/health` → 200; alias `/` → 200 TAKEOVER HTML;
  `OPTIONS` preflight for PATCH from the alias origin → 204, exact
  `ACAO: https://takeover-web-gamma.vercel.app`,
  `allow-methods: GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS`,
  `credentials: true` (round-4 regression holds live).
- Leak audit: fresh `apps/web/dist` (33 files) → 0 secret key names,
  0 `VITE_*TOKEN` names, 0 value-prefix hits (12-char prefixes,
  count-only, values never printed); served entry chunk → 0 secret
  key names.

## 6. Verification battery + residual issues

- `typecheck` clean exit 0; `lint` clean exit 0; full suite green —
  api 30 files/331 pass (unchanged) + web 16 files/129 pass (was
  14/117: +4 provider-display, +7 slot-categories, +1 form-validation
  case-c) + shared 1 pass; zero existing tests lowered or skipped.
- Residual: (1) non-list filter URL values show a blank select while
  still filtering (§3 edge); (2) no real testnet tx shape demonstrated
  (§1 caveat, fail-closed); (3) Risks B/C/D untested (unchanged).
...[truncated 3880 chars]