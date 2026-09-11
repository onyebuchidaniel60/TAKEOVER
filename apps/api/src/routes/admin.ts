// Phase 10: admin moderation surfaces. Every route requires admin auth
// (requireAdmin after requireAuth: anonymous → 401, non-admin → 403
// FORBIDDEN — endpoints do not hide their existence). No additional per-IP
// rate limit on admin endpoints (behind admin auth); documented here and in
// AI_HANDOFF. All responses use the { data, requestId } envelope.
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../../db/client';
import { requireAdmin } from '../auth/admin';
import { AppError, successBody } from '../http/errors';
import {
  disableSlot,
  disableUser,
  listAuditEvents,
  listPaymentReviews,
  listReports,
  resolvePaymentReview,
  resolveReport,
} from '../admin/service';
import {
  adminListQuerySchema,
  adminReportsQuerySchema,
  auditEventsQuerySchema,
  claimIdParamsSchema,
  disableBodySchema,
  paymentReviewResolveBodySchema,
  reportIdParamsSchema,
  reportResolveBodySchema,
  slotIdParamsSchema,
  userIdParamsSchema,
} from '../reports/validation';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/reports', async (request) => {
    await requireAdmin(request);
    const parsed = adminReportsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid query parameters.');
    }
    const db = getDb();
    const { reports, total } = await listReports(db, {
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return successBody(request, {
      reports,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  });

  app.post('/admin/reports/:reportId/resolve', { bodyLimit: 16 * 1024 }, async (request) => {
    const admin = await requireAdmin(request);
    const params = reportIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid report id.');
    }
    const body = reportResolveBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid resolution.');
    }
    const db = getDb();
    const report = await resolveReport(db, {
      reportId: params.data.reportId,
      adminId: admin.id,
      action: body.data.action,
      resolutionNotes: body.data.resolutionNotes,
      requestId: request.id,
    });
    return successBody(request, { report });
  });

  app.post('/admin/slots/:slotId/disable', { bodyLimit: 16 * 1024 }, async (request) => {
    const admin = await requireAdmin(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const body = disableBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid reason.');
    }
    const db = getDb();
    const result = await disableSlot(db, {
      slotId: params.data.slotId,
      adminId: admin.id,
      reason: body.data.reason,
      requestId: request.id,
    });
    return successBody(request, result);
  });

  app.post('/admin/users/:userId/disable', { bodyLimit: 16 * 1024 }, async (request) => {
    const admin = await requireAdmin(request);
    const params = userIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid user id.');
    }
    const body = disableBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid reason.');
    }
    const db = getDb();
    const result = await disableUser(db, {
      userId: params.data.userId,
      adminId: admin.id,
      reason: body.data.reason,
      requestId: request.id,
    });
    return successBody(request, result);
  });

  app.get('/admin/payment-reviews', async (request) => {
    await requireAdmin(request);
    const parsed = adminListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid query parameters.');
    }
    const db = getDb();
    const { reviews, total } = await listPaymentReviews(db, {
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return successBody(request, {
      reviews,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  });

  app.post('/admin/payment-reviews/:claimId/resolve', { bodyLimit: 16 * 1024 }, async (request) => {
    const admin = await requireAdmin(request);
    const params = claimIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
    }
    const body = paymentReviewResolveBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid resolution.');
    }
    const db = getDb();
    const result = await resolvePaymentReview(db, {
      claimId: params.data.claimId,
      adminId: admin.id,
      action: body.data.action,
      resolutionNotes: body.data.resolutionNotes,
      requestId: request.id,
    });
    return successBody(request, result);
  });

  app.get('/admin/audit-events', async (request) => {
    await requireAdmin(request);
    const parsed = auditEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid query parameters.');
    }
    const db = getDb();
    const { events, total } = await listAuditEvents(db, {
      eventType: parsed.data.eventType,
      entityType: parsed.data.entityType,
      entityId: parsed.data.entityId,
      actorUserId: parsed.data.actorUserId,
      since: parsed.data.since ? new Date(parsed.data.since) : undefined,
      until: parsed.data.until ? new Date(parsed.data.until) : undefined,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return successBody(request, {
      events,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  });
}
