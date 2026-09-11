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
  'payment_pending',
  'paid',
  'payment_review',
  'cancelled',
]);

export const paymentStatus = pgEnum('payment_status', [
  'created',
  'submitted',
  'verified',
  'rejected',
  'review',
]);

export const reportStatus = pgEnum('report_status', ['open', 'reviewed', 'dismissed']);
