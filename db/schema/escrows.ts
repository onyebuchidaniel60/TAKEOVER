import { bigint, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { escrowEntryType, escrowStatus, paymentToken } from './enums';
import { claims } from './claims';
import { users } from './users';

// 1 Escrow tables. The escrow row is created at escrow-intent time
// (status 'created', before any deposit), so the funded fields are nullable
// and guarded by a CHECK: every non-created row must carry the full funded
// tuple. NIM movements are mirrored here as double-entry rows; USDT movements
// live on-chain and are mirrored by the backend, never written here.
export const escrows = pgTable(
  'escrows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id')
      .notNull()
      .unique()
      .references(() => claims.id),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => users.id),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => users.id),
    paymentToken: paymentToken('payment_token').notNull(),
    amountBaseUnits: bigint('amount_base_units', { mode: 'bigint' }).notNull(),
    status: escrowStatus('status').notNull().default('created'),
    // Nullable but unique when present: the same on-chain deposit, release, or
    // refund transaction can never settle two escrows. NULLs never conflict.
    depositTxHash: text('deposit_tx_hash').unique(),
    releaseTxHash: text('release_tx_hash').unique(),
    refundTxHash: text('refund_tx_hash').unique(),
    contractAddress: text('contract_address'),
    onChainEscrowId: text('on_chain_escrow_id'),
    // Provider EVM payout address, supplied in the
    // mark-delivered body on first call and stored immutably (later calls
    // must match). Plain TEXT at DB level; hex shape enforced at the API
    // boundary and service layer.
    providerPayoutAddress: text('provider_payout_address'),
    fundedAt: timestamp('funded_at', { withTimezone: true }),
    deliveryDeadline: timestamp('delivery_deadline', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    disputeWindowEnds: timestamp('dispute_window_ends', { withTimezone: true }),
    disputedAt: timestamp('disputed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    resolutionNotes: text('resolution_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'escrows_funded_fields_check',
      sql`${t.status} = 'created' OR (${t.depositTxHash} IS NOT NULL AND ${t.fundedAt} IS NOT NULL AND ${t.deliveryDeadline} IS NOT NULL)`,
    ),
    index('escrows_status_idx').on(t.status),
  ],
);

export const escrowLedger = pgTable(
  'escrow_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    escrowId: uuid('escrow_id')
      .notNull()
      .references(() => escrows.id),
    entryType: escrowEntryType('entry_type').notNull(),
    debitAccount: text('debit_account').notNull(),
    creditAccount: text('credit_account').notNull(),
    amountBaseUnits: bigint('amount_base_units', { mode: 'bigint' }).notNull(),
    // Every entry type (deposit, release, refund) carries its on-chain tx.
    txHash: text('tx_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);
