// Public user profile read (Phase 5k-B).
//
// GET /api/v1/users/:username is unauthenticated: a public profile is a
// shareable page (/u/:username, D17) and buyers must be able to read a
// provider before signing in. The response is the allow-listed
// PublicProfile shape — see users/public-profile.ts for what is deliberately
// NOT in it.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { AppError, successBody } from '../http/errors';
import { createRateLimiter, type RateLimitOptions } from '../http/rate-limit';
import { getPublicProfile } from '../users/public-profile';

const paramsSchema = z.object({ username: z.string().min(1).max(64) });

export const DEFAULT_PUBLIC_PROFILE_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 };

export interface UserRouteOptions {
  rateLimit?: {
    /** Per-IP public profile read budget (default 60/min). */
    publicProfile?: RateLimitOptions;
  };
}

export async function userRoutes(app: FastifyInstance, opts: UserRouteOptions = {}): Promise<void> {
  const profileLimiter = createRateLimiter(
    opts.rateLimit?.publicProfile ?? DEFAULT_PUBLIC_PROFILE_RATE_LIMIT,
  );

  app.get('/users/:username', { preHandler: profileLimiter }, async (request) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
    }
    // Optional auth (Phase 5k-C): a session, if present, tells us whether
    // the viewer already follows this profile, so the Follow button renders
    // correctly in one round trip. A guest still gets a full profile.
    const profile = await getPublicProfile(getDb(), parsed.data.username, request.user?.id ?? null);
    return successBody(request, { profile });
  });
}
