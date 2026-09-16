// Phase 14d-2: escrow endpoint validation. Strict shapes, no unknown fields.
import { z } from 'zod';
import { notesField } from '../reports/validation';
export const escrowIntentBodySchema = z.object({ token: z.enum(['NIM', 'USDT_POLYGON']) }).strict();

/**
 * Deposit reference shape: hex with optional 0x prefix (Polygon tx hashes
 * are 0x-prefixed; the deprecated Nimiq path is hex-only). Hex part stays
 * 1–256 chars per the existing payment-submission bound.
 */
const polygonTxHashSchema = z
  .string()
  .min(1, { message: 'Transaction hash is required.' })
  .max(258, { message: 'Transaction hash is too long.' })
  .regex(/^(0x)?[0-9a-fA-F]+$/, { message: 'Transaction hash must be hex.' })
  .refine((v) => (v.startsWith('0x') || v.startsWith('0X') ? v.slice(2).length : v.length) >= 1, {
    message: 'Transaction hash is required.',
  })
  .refine((v) => (v.startsWith('0x') || v.startsWith('0X') ? v.slice(2).length : v.length) <= 256, {
    message: 'Transaction hash is too long.',
  });

export const escrowSubmissionBodySchema = z
  .object({ transactionHash: polygonTxHashSchema })
  .strict();

export const verifyDepositBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z.object({}).strict(),
);

// Phase 14d-3a: provider EVM payout address. Canonical hex only
// (0x/0X + 40 hex); anything else is 400 INVALID_INPUT. The service
// re-validates (defense in depth) and normalizes to lowercase on store.
export const evmAddressSchema = z
  .string()
  .regex(/^0[xX][0-9a-fA-F]{40}$/, { message: 'Provider payout address must be a 0x-prefixed EVM address.' });

export const markDeliveredBodySchema = z
  .object({ providerPayoutAddress: evmAddressSchema })
  .strict();

export const confirmReceiptBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z.object({}).strict(),
);

// Phase 14d-3b: dispute takes no input — the server hands back the on-chain
// call instruction until the Disputed event is visible.
export const disputeBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z.object({}).strict(),
);

// Phase 14d-3b: admin escrow surfaces. Resolution notes match the existing
// admin resolve bodies (5–1000 chars after trimming); unknown fields out.
export const escrowIdParamsSchema = z.object({ escrowId: z.string().uuid() }).strict();

export const escrowResolveBodySchema = z
  .object({
    action: z.enum(['release', 'refund']),
    resolutionNotes: notesField,
  })
  .strict();

export const escrowStatusValues = [
  'created',
  'funded',
  'delivered',
  'disputed',
  'released',
  'refunded',
  'refunding',
  'releasing',
] as const;

export const adminEscrowsQuerySchema = z
  .object({
    status: z.enum(escrowStatusValues).optional(),
    limit: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.coerce.number().int().min(1).max(50).default(20),
    ),
    offset: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.coerce.number().int().min(0).default(0),
    ),
  })
  .strict();
