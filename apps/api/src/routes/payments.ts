// Phase 7: payment intents + submission recording. No chain reads and no
// verification here — that is Phase 8 (see verify-payment below).
// Phase 8: POST /claims/:claimId/verify-payment checks the submitted hash
// against the Nimiq chain. All responses use the
// { data, requestId } envelope; errors use { error: { code, message }, requestId }.
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { claims } from '../../../../db/schema';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import {
  createRateLimiter,
  DEFAULT_CHALLENGE_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';
import { claimIdParamsSchema } from '../claims/validation';
import { createPaymentIntent, submitPayment } from '../payments/service';
import {
  paymentIntentBodySchema,
  paymentSubmissionBodySchema,
  paymentVerifyBodySchema,
} from '../payments/validation';
import { createRpcClient, getNimiqRpcUrl, RpcUnavailableError, type NimiqRpcClient } from '../payments/rpc';
import { verifyPayment } from '../payments/verify';
import {
  createVerifyRateLimiter,
  type VerifyRateLimiter,
  type VerifyRateLimitOptions,
} from '../payments/verify-rate-limit';

export interface PaymentRouteOptions {
  rateLimit?: {
    intent?: RateLimitOptions;
    submission?: RateLimitOptions;
    /** Per-claim verify window (default 1 per 5s). Named verifyPayment: AuthRouteOptions already owns `verify`. */
    verifyPayment?: VerifyRateLimitOptions;
  };
  /** Injected chain reader (tests). Production defaults to a fetch client. */
  rpcClient?: NimiqRpcClient;
  /** Test seam for the per-claim limiter (rarely needed — keyed by fresh claim ids). */
  verifyRateLimiter?: VerifyRateLimiter;
}

// Same per-IP mechanism and budget as the auth endpoints.
export const DEFAULT_INTENT_RATE_LIMIT: RateLimitOptions = { ...DEFAULT_CHALLENGE_RATE_LIMIT };
export const DEFAULT_SUBMISSION_RATE_LIMIT: RateLimitOptions = { ...DEFAULT_CHALLENGE_RATE_LIMIT };

export async function paymentRoutes(app: FastifyInstance, opts: PaymentRouteOptions = {}): Promise<void> {
  const intentLimiter = createRateLimiter(opts.rateLimit?.intent ?? DEFAULT_INTENT_RATE_LIMIT);
  const submissionLimiter = createRateLimiter(
    opts.rateLimit?.submission ?? DEFAULT_SUBMISSION_RATE_LIMIT,
  );
  const verifyLimiter =
    opts.verifyRateLimiter ?? createVerifyRateLimiter(opts.rateLimit?.verifyPayment);

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

  app.post(
    '/claims/:claimId/verify-payment',
    { bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = paymentVerifyBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      // Per-claim (not per-IP) scope: only payment_pending claims consume the
      // chain-lookup budget. This advisory pre-read is never trusted for
      // state — verifyPayment re-validates everything authoritatively.
      const probe = await db
        .select({ status: claims.status })
        .from(claims)
        .where(and(eq(claims.id, params.data.claimId), eq(claims.buyerId, user.id)))
        .limit(1);
      if (probe[0]?.status === 'payment_pending') {
        const decision = verifyLimiter.check(params.data.claimId);
        if (!decision.allowed) {
          void reply.header('retry-after', String(decision.retryAfterSeconds ?? 5));
          throw new AppError(
            429,
            'VERIFY_RATE_LIMITED',
            'Verification was just requested. Please try again shortly.',
          );
        }
      }
      const rpc = opts.rpcClient ?? createRpcClient(getNimiqRpcUrl());
      let result;
      try {
        result = await verifyPayment(db, {
          claimId: params.data.claimId,
          buyerId: user.id,
          rpc,
        });
      } catch (err) {
        // Transport/RPC failure: no state changed — tell the client to retry.
        if (err instanceof RpcUnavailableError) {
          throw new AppError(
            503,
            'RPC_UNAVAILABLE',
            'Payment verification is temporarily unavailable. Please try again.',
          );
        }
        throw err;
      }
      request.log.info(
        { ...result.audit, route: 'verify-payment' },
        `payment verification ${result.verification.status}`,
      );
      // The audit context is server-log only — never serialized to the client.
      return successBody(request, {
        claim: result.claim,
        intent: result.intent,
        verification: result.verification,
      });
    },
  );
}
