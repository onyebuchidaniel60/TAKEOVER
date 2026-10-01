// Claim input validation. Unknown fields are rejected per the envelope rule.
//
// Phase 5n-D: `quantity` is the only claim field. It is optional (absent = 1,
// which is what every pre-5n-D client sends) and is validated for SHAPE here —
// whole number, at least 1. The upper bound is per-slot (1..available_quantity)
// and is deliberately NOT a zod max: the number is only knowable against the
// locked slot row, so it is decided inside the transaction where the lock is
// held. A zod max would either be wrong for some slot or duplicate the check.
import { z } from 'zod';
import type { ClaimStatusValue } from './service';

export const claimIdParamsSchema = z.object({ claimId: z.string().uuid() }).strict();

export const claimCreateBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z
    .object({
      quantity: z
        .number({ invalid_type_error: 'Quantity must be a whole number.' })
        .int('Quantity must be a whole number.')
        .min(1, 'Quantity must be at least 1.')
        .optional(),
    })
    .strict(),
);

export const claimStatusValues = [
  'active_hold',
  'expired',
  'payment_pending',
  'paid',
  'payment_review',
  'cancelled',
] as const satisfies readonly ClaimStatusValue[];

export const myClaimsQuerySchema = z
  .object({
    status: z.enum(claimStatusValues).optional(),
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
