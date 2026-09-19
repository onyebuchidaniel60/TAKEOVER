// POST /api/v1/reports — any authenticated user. Rate limit:
// 5 creations per hour per user → 429 REPORT_RATE_LIMITED.
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../../db/client';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import { createReport } from '../reports/service';
import { checkReportRateLimit, recordReportCreation } from '../reports/rate-limit';
import { reportCreateBodySchema } from '../reports/validation';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.post('/reports', { bodyLimit: 16 * 1024 }, async (request, reply) => {
    const user = await requireAuth(request);
    const parsed = reportCreateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid report.');
    }
    if (!checkReportRateLimit(user.id)) {
      throw new AppError(429, 'REPORT_RATE_LIMITED', 'Too many reports. Please try again later.');
    }
    const db = getDb();
    const report = await createReport(db, {
      reporterId: user.id,
      input: parsed.data,
      requestId: request.id,
    });
    recordReportCreation(user.id);
    void reply.code(201);
    return successBody(request, { report });
  });
}
