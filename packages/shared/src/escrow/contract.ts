// Phase 14d-1: TypeScript-side binding for the Polygon USDT escrow contract.
// Interface + types + ABI const ONLY — no implementation, no network, no
// signing. The Solidity contract is a separate deliverable (its own repo)
// implementing docs/escrow-contract-interface.md; this module is the shape
// that repo implements against and that this repo's backend will call in
// 14d-2+. Reachable by apps/api (and later apps/web) via direct import.

// USDT uses 6 decimals on Polygon. Amounts are exact base-unit bigints here;
// never floats, never Javascript numbers (see baseUnitsToSafeNumber at the
// call site when a number is unavoidable).
export const USDT_DECIMALS = 6 as const;

/** Server-generated unique escrow identifier, bytes32 hex string (0x + 64 hex). */
export type EscrowIdHex = string;

/** Polygon account address, 0x-prefixed hex string. */
export type PolygonAddressHex = string;

/** Transaction hash on Polygon, 0x-prefixed 32-byte hex string. */
export type PolygonTxHashHex = string;

// -- Contract events (backend reads) ----------------------------------------
// `participant` is the buyer for Deposited/Refunded/Disputed and the provider
// for Released. `amountBaseUnits` is null for Disputed (no funds move).

export interface DepositedEvent {
  escrowId: EscrowIdHex;
  participant: PolygonAddressHex;
  amountBaseUnits: bigint;
  txHash: PolygonTxHashHex;
  blockNumber: number;
}

export interface ReleasedEvent {
  escrowId: EscrowIdHex;
  participant: PolygonAddressHex;
  amountBaseUnits: bigint;
  txHash: PolygonTxHashHex;
  blockNumber: number;
}

export interface RefundedEvent {
  escrowId: EscrowIdHex;
  participant: PolygonAddressHex;
  amountBaseUnits: bigint;
  txHash: PolygonTxHashHex;
  blockNumber: number;
}

export interface DisputedEvent {
  escrowId: EscrowIdHex;
  participant: PolygonAddressHex;
  amountBaseUnits: null;
  txHash: PolygonTxHashHex;
  blockNumber: number;
}

// -- Backend-facing client (implemented in 14d-2, extended in 14d-3a) --------

export interface EscrowContractClient {
  getDepositEvent(escrowId: string): Promise<DepositedEvent | null>;
  getDisputeEvent(escrowId: string): Promise<DisputedEvent | null>;
  release(escrowId: string, toProvider: string): Promise<{ txHash: string }>;
  refund(escrowId: string): Promise<{ txHash: string }>;
  /**
   * Receipt poll for a broadcast transaction. Returns null while the tx is
   * unknown (still propagating) or did not succeed — the caller treats both
   * as "not yet confirmed" and keeps the escrow out of its terminal state.
   */
  getTransactionReceipt(txHash: string): Promise<{ confirmations: number } | null>;
}

// -- Contract ABI (shared with the frontend later) ---------------------------
// Covers the events the backend reads (Deposited, Released, Refunded,
// Disputed) and the functions the backend calls (release, refund), plus the
// buyer-called deposit so one ABI serves both sides. Matches
// docs/escrow-contract-interface.md exactly.

export const ESCROW_CONTRACT_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'release',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'escrowId', type: 'bytes32' },
      { name: 'toProvider', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'escrowId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'dispute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'escrowId', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'escrowId', type: 'bytes32', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Released',
    inputs: [
      { name: 'escrowId', type: 'bytes32', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Refunded',
    inputs: [
      { name: 'escrowId', type: 'bytes32', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Disputed',
    inputs: [
      { name: 'escrowId', type: 'bytes32', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
    ],
  },
] as const;
