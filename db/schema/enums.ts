import { pgEnum } from 'drizzle-orm/pg-core';

// Phase 2 domain enums — values and defaults match the Phase 2 schema brief exactly.
export const userRole = pgEnum('user_role', ['buyer', 'provider', 'admin']);

export const userStatus = pgEnum('user_status', ['active', 'disabled']);

export const slotStatus = pgEnum('slot_status', [
  'draft',
  'published',
  'sold_out',
  'cancelled',
  'expired',
]);

export const claimStatus = pgEnum('claim_status', [
  'active_hold',
  'expired',
  'deposit_submitted',
  // Legacy direct-payment flow — historical rows only, do not remove.
  'payment_pending',
  // Legacy direct-payment flow — historical rows only, do not remove.
  'paid',
  // Legacy direct-payment flow — historical rows only, do not remove.
  'payment_review',
  'cancelled',
  'escrow_funded',
  'delivered',
  'disputed',
  'released',
  'refunded',
]);

export const paymentStatus = pgEnum('payment_status', [
  'created',
  'submitted',
  'verified',
  'rejected',
  'review',
]);

export const reportStatus = pgEnum('report_status', ['open', 'reviewed', 'dismissed']);

// Phase 14d-1 escrow enums. payment_token selects the rail at escrow-intent
// time; escrow_status starts at 'created' (row exists before the deposit).
export const paymentToken = pgEnum('payment_token', ['NIM', 'USDT_POLYGON']);

export const escrowStatus = pgEnum('escrow_status', [
  'created',
  'funded',
  'delivered',
  'disputed',
  'released',
  'refunded',
]);

export const escrowEntryType = pgEnum('escrow_entry_type', ['deposit', 'release', 'refund']);
