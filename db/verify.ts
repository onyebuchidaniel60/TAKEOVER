// Phase 2 tooling: connectivity check + schema confirmation.
// Reads DATABASE_URL from the environment and never logs it.
// Usage (values stay in your shell, never printed):
//   npm.cmd run db:verify [-- --expect-empty]

import { sql } from 'drizzle-orm';
import { getDb } from './client';

const expectEmpty = process.argv.includes('--expect-empty');

async function main(): Promise<void> {
  // Throws (without revealing the URL) when DATABASE_URL is missing.
  const db = getDb();

  await db.execute(sql`SELECT 1`);
  console.log('connectivity: SELECT 1 ok');

  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const names = tables.rows.map((row) => row.table_name);
  console.log(`tables (${names.length}): ${names.join(', ') || '(none)'}`);

  if (expectEmpty && names.length > 0) {
    throw new Error(`expected an empty database, found ${names.length} table(s)`);
  }

  // Phase 2 follow-up: confirm the additive columns exist.
  const expectedColumns = [
    'users.disabled_at',
    'slots.cancelled_at',
    'slots.expired_at',
    'claims.quantity',
    'reports.resolved_by_user_id',
    'reports.resolution_notes',
    'audit_events.request_id',
  ];
  const columns = await db.execute<{ table_name: string; column_name: string }>(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);
  const present = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = expectedColumns.filter((col) => !present.has(col));
  console.log(
    `follow-up columns ok (${expectedColumns.length - missing.length}/${expectedColumns.length})`,
  );
  if (missing.length > 0) {
    throw new Error(`missing columns: ${missing.join(', ')}`);
  }

  // Confirm the corrected partial-unique-index predicate (paid must be absent).
  const indexDef = await db.execute<{ indexdef: string }>(sql`
    SELECT pg_get_indexdef(indexrelid) AS indexdef
    FROM pg_index
    WHERE indexrelid = 'public.claims_one_active_per_buyer_slot'::regclass
  `);
  const def = indexDef.rows[0]?.indexdef ?? '(missing)';
  console.log(`partial index: ${def}`);
  const wanted = ["'active_hold'", "'deposit_submitted'", "'payment_pending'", "'payment_review'"];
  if (!wanted.every((s) => def.includes(s)) || def.includes("'paid'")) {
    throw new Error('claims partial index predicate does not match the reconciled definition');
  }

  // Phase 14d-1: escrow tables, enum values, and the funded-fields CHECK.
  for (const table of ['escrows', 'escrow_ledger']) {
    if (!names.includes(table)) {
      throw new Error(`missing table: ${table}`);
    }
  }
  console.log('escrow tables ok (escrows, escrow_ledger present)');

  const enumValues = await db.execute<{ enumlabel: string; typname: string }>(sql`
    SELECT e.enumlabel, t.typname
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname IN ('claim_status', 'escrow_status')
  `);
  const byType = new Map<string, Set<string>>();
  for (const row of enumValues.rows) {
    const set = byType.get(row.typname) ?? new Set<string>();
    set.add(row.enumlabel);
    byType.set(row.typname, set);
  }
  const claimLabels = byType.get('claim_status') ?? new Set<string>();
  const escrowLabels = byType.get('escrow_status') ?? new Set<string>();
  console.log(`claim_status has deposit_submitted: ${claimLabels.has('deposit_submitted')}`);
  console.log(`escrow_status has created: ${escrowLabels.has('created')}`);
  if (!claimLabels.has('deposit_submitted')) {
    throw new Error('claim_status enum is missing deposit_submitted');
  }
  if (!escrowLabels.has('created')) {
    throw new Error('escrow_status enum is missing created');
  }

  const checks = await db.execute<{ checkdef: string }>(sql`
    SELECT pg_get_constraintdef(oid) AS checkdef
    FROM pg_constraint
    WHERE conrelid = 'public.escrows'::regclass AND contype = 'c'
  `);
  const fundedCheck = checks.rows.some(
    (row) =>
      row.checkdef.includes('deposit_tx_hash') &&
      row.checkdef.includes('funded_at') &&
      row.checkdef.includes('delivery_deadline'),
  );
  console.log(`escrows funded-fields CHECK present: ${fundedCheck}`);
  if (!fundedCheck) {
    throw new Error('escrows CHECK constraint on the funded-fields tuple is missing');
  }

  // Phase 14d-2 completion: verification-window clock column.
  const hasDepositSubmittedAt = present.has('claims.deposit_submitted_at');
  console.log(`claims.deposit_submitted_at present: ${hasDepositSubmittedAt}`);
  if (!hasDepositSubmittedAt) {
    throw new Error('claims.deposit_submitted_at column is missing');
  }

  // Phase 14d-3a: provider EVM payout address column.
  const hasProviderPayoutAddress = present.has('escrows.provider_payout_address');
  console.log(`escrows.provider_payout_address present: ${hasProviderPayoutAddress}`);
  if (!hasProviderPayoutAddress) {
    throw new Error('escrows.provider_payout_address column is missing');
  }

  // Phase 14d-3b: escrow-internal transitional states for refund/release broadcasts.
  const hasRefunding = escrowLabels.has('refunding');
  const hasReleasing = escrowLabels.has('releasing');
  console.log(`escrow_status has refunding: ${hasRefunding}`);
  console.log(`escrow_status has releasing: ${hasReleasing}`);
  if (!hasRefunding || !hasReleasing) {
    throw new Error('escrow_status enum is missing refunding/releasing');
  }

  // Phase 14d-4: one-way provider contact-note column on slots.
  const hasProviderContactNote = present.has('slots.provider_contact_note');
  console.log(`slots.provider_contact_note present: ${hasProviderContactNote}`);
  if (!hasProviderContactNote) {
    throw new Error('slots.provider_contact_note column is missing');
  }

  // Phase 14g-1: NIM listing-fee receipt columns on slots.
  for (const col of ['slots.listing_fee_tx_hash', 'slots.listing_fee_paid_at']) {
    const has = present.has(col);
    console.log(`${col} present: ${has}`);
    if (!has) {
      throw new Error(`${col} column is missing`);
    }
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
