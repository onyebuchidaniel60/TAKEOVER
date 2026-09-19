// Atomic buyer claims. No money moves here — holds only.
// All responses use the { data, requestId } envelope; errors use
// { error: { code, message }, requestId }.
import type { FastifyInstance } from 'fastify';
import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { claims } from '../../../../db/schema';
import { requireAuth } from '../auth/session';
import { getClaimHoldTtlSeconds } from '../env';
import { AppError, successBody } from '../http/errors';
import {
  createRateLimiter,
  DEFAULT_CLAIM_CREATE_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';
import {
  createClaim,
  expireHoldsForSlot,
  getClaimForBuyer,
  listBuyerClaims,
} from '../claims/service';
import { slotIdParamsSchema } from '../slots/validation';
import {
  claimCreateBodySchema,
  claimIdParamsSchema,
  myClaimsQuerySchema,
} from '../claims/validation';

export interface ClaimRouteOptions {
  rateLimit?: {
    /** Per-IP claim-creation budget (default 60/min). Bounds availability probing. */
    claimCreate?: RateLimitOptions;
  };
}

export async function claimRoutes(app: FastifyInstance, opts: ClaimRouteOptions = {}): Promise<void> {
  const claimCreateLimiter = createRateLimiter(
    opts.rateLimit?.claimCreate ?? DEFAULT_CLAIM_CREATE_RATE_LIMIT,
  );

  app.post('/slots/:slotId/claims', { preHandler: claimCreateLimiter }, async (request) => {
    const user = await requireAuth(request);
    const params = slotIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid slot id.');
    }
    const body = claimCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid request body.');
    }
    const db = getDb();
    const now = new Date();
    // Lazy expiry runs before the claim attempt so freed units are claimable.
    await expireHoldsForSlot(db, params.data.slotId, now);
    const { claim, slot } = await createClaim(db, {
      slotId: params.data.slotId,
      buyerId: user.id,
      now,
      ttlSeconds: getClaimHoldTtlSeconds(),
      requestId: request.id,
    });
    return successBody(request, { claim, slot });
  });

  app.get('/claims/:claimId', async (request) => {
    const user = await requireAuth(request);
    const params = claimIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid claim id.');
    }
    const db = getDb();
    const found = await getClaimForBuyer(db, params.data.claimId, user.id);
    if (!found) {
      throw new AppError(404, 'CLAIM_NOT_FOUND', 'Claim not found.');
    }
    return successBody(request, found);
  });

  app.get('/me/claims', async (request) => {
    const user = await requireAuth(request);
    const parsed = myClaimsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid query parameters.');
    }
    const db = getDb();
    const now = new Date();
    // Lazy expiry for every slot where this buyer holds a past-due hold,
    // before listing — so the list never shows stale holds as live.
    const stale = await db
      .selectDistinct({ slotId: claims.slotId })
      .from(claims)
      .where(
        and(
          eq(claims.buyerId, user.id),
          eq(claims.status, 'active_hold'),
          lt(claims.holdExpiresAt, now),
        ),
      );
    for (const row of stale) {
      await expireHoldsForSlot(db, row.slotId, now);
    }
    const { claims: items, total } = await listBuyerClaims(db, user.id, {
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return successBody(request, {
      claims: items,
      total,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  });
}
