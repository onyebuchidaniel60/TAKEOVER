// Phase 14f P-NIM-1: NIM escrow double-entry ledger foundation.
//
// Account-naming convention (locked for the NIM track):
//   escrow:wallet          — the single omnibus custodial NIM escrow wallet (D2)
//   buyer:user:<buyerId>    — the funding buyer (user id, never a raw address)
//   provider:user:<userId>  — the provider receiving a release
//
// Movements:
//   deposit: debit buyer:user:<buyerId> / credit escrow:wallet
//   release: debit escrow:wallet / credit provider:user:<providerId>   (P-NIM-2)
//   refund:  debit escrow:wallet / credit buyer:user:<buyerId>          (P-NIM-2)
//
// Write discipline: every row is written INSIDE the same DB transaction as
// the claim/escrow state change it describes — ledger and action succeed or
// fail together (same rule as writeAuditEvent). Rows represent SETTLED
// movements only (verified deposit, confirmed release/refund) — never
// in-flight broadcasts. tx_hash carries the mined on-chain hash (NOT NULL
// per schema). The invariant check + halt land in P-NIM-2 and read these
// rows; this phase establishes the helper and the deposit write only.
import { getDb } from '../../../../db/client';
import { escrowLedger } from '../../../../db/schema';

type Db = ReturnType<typeof getDb>;
/** Minimal surface needed to insert: satisfied by both db and tx objects. */
export type LedgerTx = Pick<Db, 'insert'>;

export const LEDGER_ESCROW_WALLET_ACCOUNT = 'escrow:wallet';

export function buyerLedgerAccount(buyerId: string): string {
  return `buyer:user:${buyerId}`;
}

export function providerLedgerAccount(providerId: string): string {
  return `provider:user:${providerId}`;
}

export type EscrowLedgerEntryType = 'deposit' | 'release' | 'refund';

const ENTRY_TYPES: readonly EscrowLedgerEntryType[] = ['deposit', 'release', 'refund'];

export interface WriteLedgerOptions {
  escrowId: string;
  entryType: EscrowLedgerEntryType;
  debitAccount: string;
  creditAccount: string;
  /** Integer base units (luna) as bigint. Must be > 0. */
  amountBaseUnits: bigint;
  /** Mined on-chain transaction hash. Never empty. */
  txHash: string;
}

/** Insert exactly one escrow_ledger row using the caller's transaction handle. */
export async function writeLedgerEntry(tx: LedgerTx, options: WriteLedgerOptions): Promise<void> {
  if (!ENTRY_TYPES.includes(options.entryType)) {
    throw new Error('Invalid ledger entry type.');
  }
  if (typeof options.amountBaseUnits !== 'bigint' || options.amountBaseUnits <= 0n) {
    throw new Error('Invalid ledger amount.');
  }
  if (typeof options.txHash !== 'string' || options.txHash.trim() === '') {
    throw new Error('Invalid ledger transaction hash.');
  }
  await tx.insert(escrowLedger).values({
    escrowId: options.escrowId,
    entryType: options.entryType,
    debitAccount: options.debitAccount,
    creditAccount: options.creditAccount,
    amountBaseUnits: options.amountBaseUnits,
    txHash: options.txHash,
  });
}
