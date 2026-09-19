// Claim input validation. Bodies carry no claim fields — claiming
// takes no input — but unknown fields are still rejected per the envelope rule.
import { z } from 'zod';
import type { ClaimStatusValue } from './service';

export const claimIdParamsSchema = z.object({ claimId: z.string().uuid() }).strict();

export const claimCreateBodySchema = z.preprocess(
  (value: unknown) => (value === undefined ? {} : value),
  z.object({}).strict(),
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
