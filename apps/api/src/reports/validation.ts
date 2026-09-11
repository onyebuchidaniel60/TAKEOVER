// Phase 10: report + admin moderation input validation. All external input
// is validated at the API boundary with Zod; unknown fields are rejected.
import { z } from 'zod';

// PROJECT_SPEC.md FR-10 categories (snake_case stored value and API field).
export const reportReasonValues = [
  'misleading_listing',
  'unauthorized_listing',
  'prohibited_content',
  'payment_issue',
  'other',
] as const;
export type ReportReason = (typeof reportReasonValues)[number];

export const reportCreateBodySchema = z
  .object({
    slotId: z.string().uuid().optional(),
    targetUserId: z.string().uuid().optional(),
    reason: z.enum(reportReasonValues),
    details: z.string().max(2000).optional(),
  })
  .strict();

export type ReportCreateInput = z.infer<typeof reportCreateBodySchema>;

export const reportStatusValues = ['open', 'reviewed', 'dismissed'] as const;

export const adminReportsQuerySchema = z
  .object({
    status: z.enum(reportStatusValues).optional(),
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

export const reportIdParamsSchema = z.object({ reportId: z.string().uuid() }).strict();

/** Resolution notes / disable reasons: 5–1000 chars after trimming. */
export const notesField = z.string().trim().min(5).max(1000);

export const reportResolveBodySchema = z
  .object({
    action: z.enum(['reviewed', 'dismissed']),
    resolutionNotes: notesField,
  })
  .strict();

export const disableBodySchema = z
  .object({
    reason: notesField,
  })
  .strict();

export const slotIdParamsSchema = z.object({ slotId: z.string().uuid() }).strict();
export const userIdParamsSchema = z.object({ userId: z.string().uuid() }).strict();
export const claimIdParamsSchema = z.object({ claimId: z.string().uuid() }).strict();

export const paymentReviewResolveBodySchema = z
  .object({
    action: z.enum(['confirm_paid', 'reject']),
    resolutionNotes: notesField,
  })
  .strict();

export const adminListQuerySchema = z
  .object({
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

export const auditEventsQuerySchema = z
  .object({
    eventType: z.string().max(100).optional(),
    entityType: z.string().max(100).optional(),
    entityId: z.string().max(200).optional(),
    actorUserId: z.string().uuid().optional(),
    since: z.string().datetime({ offset: true }).optional(),
    until: z.string().datetime({ offset: true }).optional(),
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

/**
 * Pure guard: at least one of slotId / targetUserId is required.
 * Returns true when the body targets something.
 */
export function hasReportTarget(input: { slotId?: string; targetUserId?: string }): boolean {
  return input.slotId !== undefined || input.targetUserId !== undefined;
}
