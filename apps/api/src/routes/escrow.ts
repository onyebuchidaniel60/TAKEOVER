// Phase 14d-2: USDT escrow deposit endpoints (no NIM, no release/refund).
// Phase 14d-3a: delivery + release endpoints (mark-delivered, confirm-receipt;
// GET /escrow now buyer- or provider-scoped).
// All responses use the { data, requestId } envelope; errors use
// { error: { code, message }, requestId }. Rate limits are configuration per
// ARCH §14, overridable via AppOptions for tests (Phase 12 pattern).
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
import {
  createVerifyRateLimiter,
  type VerifyRateLimiter,
  type VerifyRateLimitOptions,
} from '../payments/verify-rate-limit';
import { claimIdParamsSchema } from '../claims/validation';
import {
  createPolygonEscrowClient,
  EscrowContractUnavailableError,
  EscrowSignerUnavailableError,
  type RawEscrowLog,
} from '../escrow/polygon/client';
import type { EscrowContractClient } from '../../../../packages/shared/src/escrow/contract';
import {
  confirmReceipt,
  createEscrowIntent,
  dispute,
  getEscrowForBuyer,
  getEscrowForProvider,
  markDelivered,
  submitDepositReference,
  verifyDeposit,
} from '../escrow/service';
import {
  confirmReceiptBodySchema,
  disputeBodySchema,
  escrowIntentBodySchema,
  escrowSubmissionBodySchema,
  markDeliveredBodySchema,
  verifyDepositBodySchema,
} from '../escrow/validation';

export interface EscrowRouteOptions {
  rateLimit?: {
    escrowIntent?: RateLimitOptions;
    escrowSubmission?: RateLimitOptions;
    /** Per-claim verify window (default 1 per 5s, same as deprecated verify-payment). */
    verifyDeposit?: VerifyRateLimitOptions;
    markDelivered?: RateLimitOptions;
    confirmReceipt?: RateLimitOptions;
    dispute?: RateLimitOptions;
  };
  /** Injected chain reader (tests). Production defaults to the viem Polygon client. */
  escrowClient?: EscrowContractClient;
  /** Test seam for the per-claim limiter (rarely needed — keyed by fresh claim ids). */
  verifyDepositRateLimiter?: VerifyRateLimiter;
}

export const DEFAULT_ESCROW_INTENT_RATE_LIMIT: RateLimitOptions = {
  ...DEFAULT_CHALLENGE_RATE_LIMIT,
};
export const DEFAULT_ESCROW_SUBMISSION_RATE_LIMIT: RateLimitOptions = {
  ...DEFAULT_CHALLENGE_RATE_LIMIT,
};
export const DEFAULT_MARK_DELIVERED_RATE_LIMIT: RateLimitOptions = {
  ...DEFAULT_CHALLENGE_RATE_LIMIT,
};
export const DEFAULT_CONFIRM_RECEIPT_RATE_LIMIT: RateLimitOptions = {
  ...DEFAULT_CHALLENGE_RATE_LIMIT,
};
export const DEFAULT_DISPUTE_RATE_LIMIT: RateLimitOptions = {
  ...DEFAULT_CHALLENGE_RATE_LIMIT,
};

function resolveEscrowClient(
  opts: EscrowRouteOptions,
  unavailable: { code: string; message: string } = {
    code: 'ESCROW_CONTRACT_UNAVAILABLE',
    message: 'Deposit verification is temporarily unavailable. Please try again.',
  },
): EscrowContractClient {
  if (opts.escrowClient) {
    return opts.escrowClient;
  }
  try {
    return createPolygonEscrowClient();
  } catch (err) {
    if (err instanceof EscrowContractUnavailableError) {
      throw new AppError(503, unavailable.code, unavailable.message);
    }
    throw err;
  }
}

export async function escrowRoutes(app: FastifyInstance, opts: EscrowRouteOptions = {}): Promise<void> {
  const intentLimiter = createRateLimiter(
    opts.rateLimit?.escrowIntent ?? DEFAULT_ESCROW_INTENT_RATE_LIMIT,
  );
  const submissionLimiter = createRateLimiter(
    opts.rateLimit?.escrowSubmission ?? DEFAULT_ESCROW_SUBMISSION_RATE_LIMIT,
  );
  const verifyLimiter =
    opts.verifyDepositRateLimiter ?? createVerifyRateLimiter(opts.rateLimit?.verifyDeposit);
  const markDeliveredLimiter = createRateLimiter(
    opts.rateLimit?.markDelivered ?? DEFAULT_MARK_DELIVERED_RATE_LIMIT,
  );
  const confirmReceiptLimiter = createRateLimiter(
    opts.rateLimit?.confirmReceipt ?? DEFAULT_CONFIRM_RECEIPT_RATE_LIMIT,
  );
  const disputeLimiter = createRateLimiter(
    opts.rateLimit?.dispute ?? DEFAULT_DISPUTE_RATE_LIMIT,
  );

  app.post(
    '/claims/:claimId/escrow-intent',
    { preHandler: intentLimiter, bodyLimit: 16 * 1024 },
    async (request) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = escrowIntentBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      const result = await createEscrowIntent(db, {
        claimId: params.data.claimId,
        buyerId: user.id,
        token: body.data.token,
        requestId: request.id,
      });
      return successBody(request, result);
    },
  );

  app.post(
    '/claims/:claimId/escrow-submission',
    { preHandler: submissionLimiter, bodyLimit: 16 * 1024 },
    async (request) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = escrowSubmissionBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      const result = await submitDepositReference(db, {
        claimId: params.data.claimId,
        buyerId: user.id,
        txHash: body.data.transactionHash,
        requestId: request.id,
      });
      return successBody(request, result);
    },
  );

  app.post(
    '/claims/:claimId/verify-deposit',
    { bodyLimit: 16 * 1024 },
    async (request, reply) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = verifyDepositBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      // Per-claim (not per-IP) scope: only deposit_submitted claims consume the
      // chain-lookup budget. Advisory pre-read only — verifyDeposit re-checks.
      const probe = await db
        .select({ status: claims.status })
        .from(claims)
        .where(and(eq(claims.id, params.data.claimId), eq(claims.buyerId, user.id)))
        .limit(1);
      if (probe[0]?.status === 'deposit_submitted') {
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
              'ESCROW_CONTRACT_UNAVAILABLE',
              'Deposit verification is temporarily unavailable. Please try again.',
            );
          }
          throw err;
        }
      }
      const result = await verifyDeposit(db, {
        claimId: params.data.claimId,
        buyerId: user.id,
        client,
        requestId: request.id,
      });
      // Server-log only: status + reason codes, never wallets or tx hashes.
      request.log.info(
        { claimId: params.data.claimId, status: result.status, reason: result.reason ?? null },
        `escrow verify-deposit ${result.status}`,
      );
      return successBody(request, result);
    },
  );

  app.post(
    '/claims/:claimId/mark-delivered',
    { preHandler: markDeliveredLimiter, bodyLimit: 16 * 1024 },
    async (request) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = markDeliveredBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      const result = await markDelivered(db, {
        claimId: params.data.claimId,
        providerId: user.id,
        providerPayoutAddress: body.data.providerPayoutAddress,
        requestId: request.id,
      });
      return successBody(request, result);
    },
  );

  app.post(
    '/claims/:claimId/confirm-receipt',
    { preHandler: confirmReceiptLimiter, bodyLimit: 16 * 1024 },
    async (request) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = confirmReceiptBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      const client = resolveEscrowClient(opts, {
        code: 'ESCROW_RELEASE_FAILED',
        message: 'Release is temporarily unavailable. Please try again.',
      });
      try {
        const result = await confirmReceipt(db, {
          claimId: params.data.claimId,
          buyerId: user.id,
          client,
          requestId: request.id,
        });
        // Server-log only: status codes, never wallets or tx hashes.
        request.log.info(
          { claimId: params.data.claimId, status: result.status },
          `escrow confirm-receipt ${result.status}`,
        );
        return successBody(request, result);
      } catch (err) {
        if (
          err instanceof EscrowSignerUnavailableError ||
          err instanceof EscrowContractUnavailableError
        ) {
          throw new AppError(
            503,
            'ESCROW_RELEASE_FAILED',
            'Release is temporarily unavailable. Please try again.',
          );
        }
        throw err;
      }
    },
  );

  app.get('/claims/:claimId/escrow', async (request) => {
    const user = await requireAuth(request);
    const params = claimIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
    }
    const db = getDb();
    // Lazy transitions need the chain client, but a down RPC must not break
    // reads that cannot transition: pass undefined and let the service fail
    // closed (503) only when a transition is actually due.
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
    try {
      const result = await getEscrowForBuyer(db, {
        claimId: params.data.claimId,
        buyerId: user.id,
        client,
        requestId: request.id,
      });
      return successBody(request, result);
    } catch (err) {
      if (err instanceof AppError && err.code === 'CLAIM_NOT_FOUND') {
        const result = await getEscrowForProvider(db, {
          claimId: params.data.claimId,
          providerId: user.id,
          client,
          requestId: request.id,
        });
        return successBody(request, result);
      }
      throw err;
    }
  });

  app.post(
    '/claims/:claimId/dispute',
    { preHandler: disputeLimiter, bodyLimit: 16 * 1024 },
    async (request) => {
      const user = await requireAuth(request);
      const params = claimIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
      }
      const body = disputeBodySchema.safeParse(request.body);
      if (!body.success) {
        throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
      }
      const db = getDb();
      const client = resolveEscrowClient(opts, {
        code: 'ESCROW_CONTRACT_UNAVAILABLE',
        message: 'Dispute status is temporarily unavailable. Please try again.',
      });
      const result = await dispute(db, {
        claimId: params.data.claimId,
        buyerId: user.id,
        client,
        requestId: request.id,
      });
      // Server-log only: status codes, never wallets, calldata, or tx hashes.
      request.log.info(
        { claimId: params.data.claimId, status: result.status },
        `escrow dispute ${result.status}`,
      );
      return successBody(request, result);
    },
  );
}

// Re-exported for the ABI-decoding test surface (no network).
export type { RawEscrowLog };
