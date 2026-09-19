// Admin moderation surfaces. Every route requires admin auth
// (requireAdmin after requireAuth: anonymous → 401, non-admin → 403
// FORBIDDEN — endpoints do not hide their existence). adds a generous
// per-IP backstop limiter behind admin auth (abuse tripwire, not the control —
// admin auth + audit remain the control). All responses use the
// { data, requestId } envelope.
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../../db/client';
import { requireAdmin } from '../auth/admin';
import { AppError, successBody } from '../http/errors';
import {
  createRateLimiter,
  DEFAULT_ADMIN_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';
import {
  disableSlot,
  disableUser,
  listAuditEvents,
  listEscrowsForAdmin,
  listPaymentReviews,
  listReports,
  resolveDispute,
  resolvePaymentReview,
  resolveReport,
} from '../admin/service';
import {
  createPolygonEscrowClient,
  EscrowContractUnavailableError,
} from '../escrow/polygon/client';
import type { EscrowContractClient } from '../../../../packages/shared/src/escrow/contract';
import {
  adminEscrowsQuerySchema,
  escrowIdParamsSchema,
  escrowResolveBodySchema,
} from '../escrow/validation';
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

export interface AdminRouteOptions {
  rateLimit?: {
    /** Per-IP admin backstop budget shared by all admin routes (default 120/min). */
    admin?: RateLimitOptions;
  };
  /** Injected chain reader/broadcaster (tests). Production defaults to the viem Polygon client. */
  escrowClient?: EscrowContractClient;
}

export async function adminRoutes(app: FastifyInstance, opts: AdminRouteOptions = {}): Promise<void> {
  const adminLimiter = createRateLimiter(opts.rateLimit?.admin ?? DEFAULT_ADMIN_RATE_LIMIT);

  app.get('/admin/reports', { preHandler: adminLimiter }, async (request) => {
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

  app.post('/admin/reports/:reportId/resolve', { preHandler: adminLimiter, bodyLimit: 16 * 1024 }, async (request) => {
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

  app.post('/admin/slots/:slotId/disable', { preHandler: adminLimiter, bodyLimit: 16 * 1024 }, async (request) => {
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

  app.post('/admin/users/:userId/disable', { preHandler: adminLimiter, bodyLimit: 16 * 1024 }, async (request) => {
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

  app.get('/admin/payment-reviews', { preHandler: adminLimiter }, async (request) => {
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

  app.post('/admin/payment-reviews/:claimId/resolve', { preHandler: adminLimiter, bodyLimit: 16 * 1024 }, async (request) => {
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

  app.get('/admin/audit-events', { preHandler: adminLimiter }, async (request) => {
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

  app.get('/admin/escrows', { preHandler: adminLimiter }, async (request) => {
    await requireAdmin(request);
    const parsed = adminEscrowsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid query parameters.');
    }
    const db = getDb();
    // Same lazy-transition rule as GET /escrow: a down RPC must not break
    // the list, but a due transition without a client fails closed.
    let client: EscrowContractClient | undefined;
    if (opts.escrowClient) {
      client = opts.escrowClient;
    } else {
      try {
        client = createPolygonEscrowClient();
      } catch (err) {
        if (!(err instanceof EscrowContractUnavailableError)) {
          throw err;
        }
        client = undefined;
      }
    }
    const { escrows: rows, total } = await listEscrowsForAdmin(db, {
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      client,
      requestId: request.id,
    });
    return successBody(request, {
      escrows: rows,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  });

  app.post('/admin/escrows/:escrowId/resolve', { preHandler: adminLimiter, bodyLimit: 16 * 1024 }, async (request) => {
    const admin = await requireAdmin(request);
    const params = escrowIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid escrow id.');
    }
    const body = escrowResolveBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid resolution.');
    }
    const db = getDb();
    let client: EscrowContractClient;
    if (opts.escrowClient) {
      client = opts.escrowClient;
    } else {
      try {
        client = createPolygonEscrowClient();
      } catch (err) {
        if (err instanceof EscrowContractUnavailableError) {
          throw new AppError(
            503,
            body.data.action === 'release' ? 'ESCROW_RELEASE_FAILED' : 'ESCROW_REFUND_FAILED',
            'Resolution is temporarily unavailable. Please try again.',
          );
        }
        throw err;
      }
    }
    const result = await resolveDispute(db, {
      escrowId: params.data.escrowId,
      adminId: admin.id,
      action: body.data.action,
      resolutionNotes: body.data.resolutionNotes,
      client,
      requestId: request.id,
    });
    // Server-log only: action + escrow id, never notes or tx hashes.
    request.log.info(
      { escrowId: params.data.escrowId, action: body.data.action },
      `admin escrow resolve ${body.data.action}`,
    );
    return successBody(request, result);
  });
}
