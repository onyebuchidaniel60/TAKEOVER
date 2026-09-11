// Phase 7: payment intents + submission recording. No chain reads and no
// verification here — that is Phase 8. All responses use the
// { data, requestId } envelope; errors use { error: { code, message }, requestId }.
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../../../db/client';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import {
  createRateLimiter,
  DEFAULT_CHALLENGE_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';
import { claimIdParamsSchema } from '../claims/validation';
import { createPaymentIntent, submitPayment } from '../payments/service';
import { paymentIntentBodySchema, paymentSubmissionBodySchema } from '../payments/validation';

export interface PaymentRouteOptions {
  rateLimit?: {
    intent?: RateLimitOptions;
    submission?: RateLimitOptions;
  };
}

// Same per-IP mechanism and budget as the auth endpoints.
export const DEFAULT_INTENT_RATE_LIMIT: RateLimitOptions = { ...DEFAULT_CHALLENGE_RATE_LIMIT };
export const DEFAULT_SUBMISSION_RATE_LIMIT: RateLimitOptions = { ...DEFAULT_CHALLENGE_RATE_LIMIT };

export async function paymentRoutes(app: FastifyInstance, opts: PaymentRouteOptions = {}): Promise<void> {
  const intentLimiter = createRateLimiter(opts.rateLimit?.intent ?? DEFAULT_INTENT_RATE_LIMIT);
  const submissionLimiter = createRateLimiter(
    opts.rateLimit?.submission ?? DEFAULT_SUBMISSION_RATE_LIMIT,
  );

  app.post(
    '/claims/:claimId/payment-intent',
    { preHandler: intentLimiter, bodyLimit: 16 * 1024 },
    async (request) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = paymentIntentBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      const result = await createPaymentIntent(db, {
        claimId: params.data.claimId,
        buyerId: user.id,
      });
      return successBody(request, result);
    },
  );

  app.post(
    '/claims/:claimId/payment-submission',
    { preHandler: submissionLimiter, bodyLimit: 16 * 1024 },
    async (request) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = paymentSubmissionBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      const result = await submitPayment(db, {
        claimId: params.data.claimId,
        buyerId: user.id,
        txHash: body.data.txHash,
      });
      return successBody(request, result);
    },
  );
}
