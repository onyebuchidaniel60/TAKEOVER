// Phase 7: payment-intent input validation. The intent endpoint takes no
// fields (unknown fields still rejected); the submission takes only txHash.
import { z } from 'zod';

export const paymentIntentBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z.object({}).strict(),
);

/**
 * Transaction hash shape: non-empty hex, bounded length. Hex-only (no 0x
 * prefix): the hash is an opaque on-chain reference in Phase 7 — existence
 * and semantics are Phase 8's job. Real Nimiq hashes are 64 hex chars; the
 * bound stays generous so valid formats are never rejected here.
 */
export const txHashSchema = z
  .string()
  .min(1, { message: 'Transaction hash is required.' })
  .max(256, { message: 'Transaction hash is too long.' })
  .regex(/^[0-9a-fA-F]+$/, { message: 'Transaction hash must be hex.' });

export const paymentSubmissionBodySchema = z.object({ txHash: txHashSchema }).strict();

// Phase 8: verify-payment takes no fields (unknown fields still rejected).
export const paymentVerifyBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z.object({}).strict(),
);
