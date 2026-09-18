// Phase 14l-2: in-app notifications (list, mark read, mark all read).
// All responses use the { data, requestId } envelope; errors use
// { error: { code, message }, requestId }. Owner-scoped: foreign rows
// read as 404 (never an existence leak), anonymous callers 401.
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../../db/client';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import {
  createRateLimiter,
  DEFAULT_NOTIFICATIONS_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../notifications/service';
import { notificationIdParamsSchema } from '../notifications/validation';

export interface NotificationRouteOptions {
  rateLimit?: {
    /** Per-IP notifications budget (default 60/min). */
    notifications?: RateLimitOptions;
  };
}

export async function notificationRoutes(
  app: FastifyInstance,
  opts: NotificationRouteOptions = {},
): Promise<void> {
  const notificationsLimiter = createRateLimiter(
    opts.rateLimit?.notifications ?? DEFAULT_NOTIFICATIONS_RATE_LIMIT,
  );

  app.get('/me/notifications', { preHandler: notificationsLimiter }, async (request) => {
    const user = await requireAuth(request);
    const db = getDb();
    const { notifications, unreadCount } = await listNotifications(db, user.id);
    return successBody(request, { notifications, unreadCount });
  });

  app.post('/me/notifications/:id/read', { preHandler: notificationsLimiter }, async (request) => {
    const user = await requireAuth(request);
    const params = notificationIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid notification id.');
    }
    const db = getDb();
    // Idempotent: an already-read owned row returns its view, no second write.
    const notification = await markNotificationRead(db, user.id, params.data.id);
    if (!notification) {
      throw new AppError(404, 'NOT_FOUND', 'Notification not found.');
    }
    return successBody(request, { notification });
  });

  app.post('/me/notifications/read-all', { preHandler: notificationsLimiter }, async (request) => {
    const user = await requireAuth(request);
    const db = getDb();
    const { marked } = await markAllNotificationsRead(db, user.id);
    return successBody(request, { marked });
  });
}
