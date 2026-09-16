# Escrow contract interface (Polygon USDT)

Authoritative spec for the USDT escrow contract in this repo under
`contracts/`. That directory implements this document; this repo's backend
calls it (14d-2+) through the TypeScript binding in
`packages/shared/src/escrow/contract.ts`, whose ABI mirrors the signatures
below exactly. Do NOT write Solidity in this document.

## Contract name and standard

- Name: `TakeoverEscrow` (working title; the Solidity implementation phase owns the final name).
- A single escrow contract on Polygon holding USDT (ERC-20, 6 decimals).
- Solidity `^0.8.x`, OpenZeppelin `SafeERC20` and `ReentrancyGuard` base
  contracts. Fixed from the audit requirement; no alternatives.

## USDT token address

Read at construction (constructor parameter) and stored immutably. The
contract must NOT hardcode the token address (testnet/mainnet
flexibility). All deposits must be in that token; anything else reverts.

## Escrow ID

`bytes32`, server-generated, unique per escrow (this repo's backend
mints it at escrow-intent time and stores it as `on_chain_escrow_id`).
The contract treats the ID as opaque: it never decodes it and never
accepts the same ID twice for funding.

## Buyer / provider binding

- Buyer: `msg.sender` of the first (and only) successful `deposit` for
  the escrow ID. A second `deposit` for the same ID reverts, so the
  buyer is fixed at funding time.
- Provider: supplied by the trusted signer as the `toProvider` argument
  to `release()` (model (b), decided — see "Provider binding decision"
  below). No on-chain provider registration step; no pre-deposit
  transaction. The backend collects the provider payout address at delivery
  time and stores it immutably on the escrow row.

## Function signatures

All state-changing functions are `nonpayable` and reentrancy-guarded.
`ESCROW_SIGNER` is the server signer address set at construction
(backend calls only).

```
deposit(bytes32 escrowId, uint256 amount)   // buyer-called; requires prior approval of exact `amount`
release(bytes32 escrowId, address toProvider)   // ESCROW_SIGNER only; backend calls after Delivered + confirm/window-expiry
refund(bytes32 escrowId)                     // ESCROW_SIGNER only; backend calls after Funded-timeout or dispute resolution
dispute(bytes32 escrowId)                    // buyer-called; while Funded and unterminated
```

On-chain `require`s (checkable by the contract):
- `deposit`: escrow ID never funded before; `amount > 0`; caller has
  approved exactly `amount` (transfer uses `safeTransferFrom`, so an
  exact approval is both necessary and sufficient — infinite approval
  is never required and must not be requested).
- `release` / `refund`: caller is `ESCROW_SIGNER`; escrow is Funded;
  escrow is unterminated (neither released nor refunded before).
- `dispute`: caller is the recorded buyer; escrow is Funded and
  unterminated.

Backend calling rules (NOT on-chain `require`s — `Delivered` is
backend-side state; see Trust boundary):
- `release` only after the backend's Delivered precondition holds
  (buyer confirmed, or the undisputed window expired).
- `refund` only after delivery timeout with no delivery, or after an
  admin resolution for the buyer.
- `dispute` is relayed as-is; the window itself is backend-owned.

## Event signatures

```
event Deposited(bytes32 indexed escrowId, address indexed buyer, uint256 amount)
event Released(bytes32 indexed escrowId, address indexed provider, uint256 amount)
event Refunded(bytes32 indexed escrowId, address indexed buyer, uint256 amount)
event Disputed(bytes32 indexed escrowId, address indexed buyer)
```

Every state transition emits exactly one event, after state is written
(see Invariants). The backend matches events to its DB rows by escrow ID
(plus exact amount for deposits) against the configured contract address
only.

## Invariants

- Exact-amount approval only; the contract must NOT require or accept
  infinite approval (per AGENTS.md Polygon rules).
- Single deposit per escrowId; a second `deposit` reverts.
- `release` / `refund` / `dispute` revert unless the escrow has been funded.
- `release` and `refund` are mutually exclusive per escrow.
- Reentrancy-guarded; state written before external transfer.
- No upgradeability (immutable deployment; per AGENTS.md).

## Trust boundary

What the contract does NOT do: it does not know about delivery, it does
not know about dispute windows beyond the timestamp it enforces, and it
does not resolve disputes. Those are backend decisions that trigger
`release` or `refund`. The backend does not verify the depositing EVM
address against a Nimiq wallet; the escrowId functions as a bearer
capability and the contract's single-deposit and exact-amount rules are
the boundary.

## Provider binding decision (model (b), owner-decided)

`release()` takes the provider address as a `toProvider` parameter and
pays it out. The signer key is already trusted with release authority;
letting it also specify the destination does not expand the threat
surface (a compromised signer could already release to a provider it
controlled under any registration model). No pre-deposit transaction is
needed, so gas cost and failure modes are lower. Auditability is
preserved because the `Released` event records the actual destination.

## Open question (resolved — retained as decision record)

**Provider binding for `release()`.** Decided as model (b) above; option
(a) (signer-only creation function) was rejected. Original analysis
retained: the contract must send USDT to the provider, but the
pre-decision function list gave it no provider input (deposit carries no
provider argument; the server-generated escrow ID is opaque on-chain).
