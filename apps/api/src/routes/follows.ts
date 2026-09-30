// Follow endpoints (Phase 5k-C).
//
// POST/DELETE require auth; the two list reads are public (a profile's
// follower list is public information, like the profile itself). The
// optional-auth helper resolves a session when present and yields null for
// a guest, so `isFollowing` is simply null for anonymous readers rather
// than forcing those two routes behind a login.
import type { FastifyRequest } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import { createRateLimiter, type RateLimitOptions } from '../http/rate-limit';
import {
  findUserIdByUsername,
  followUser,
  getFollowCounts,
  isFollowing,
  listFollows,
  unfollowUser,
} from '../follows/service';

const paramsSchema = z.object({ username: z.string().min(1).max(64) });
const directionSchema = z.enum(['followers', 'following']);

export const DEFAULT_FOLLOW_MUTATE_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 30 };
export const DEFAULT_FOLLOW_LIST_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 };

export interface FollowRouteOptions {
  rateLimit?: {
    /** Per-IP follow/unfollow budget (default 30/min). */
    mutate?: RateLimitOptions;
    /** Per-IP follower/following list budget (default 60/min). */
    list?: RateLimitOptions;
  };
}

/**
 * Session user if a valid cookie is present, else null. Never throws.
 * sessionMiddleware has already resolved and attached request.user, so
 * this is a read — a guest and a bad cookie are both simply "no viewer".
 */
async function optionalUser(request: FastifyRequest): Promise<string | null> {
  return request.user?.id ?? null;
}

export async function followRoutes(
  app: FastifyInstance,
  opts: FollowRouteOptions = {},
): Promise<void> {
  const mutateLimiter = createRateLimiter(
    opts.rateLimit?.mutate ?? DEFAULT_FOLLOW_MUTATE_RATE_LIMIT,
  );
  const listLimiter = createRateLimiter(opts.rateLimit?.list ?? DEFAULT_FOLLOW_LIST_RATE_LIMIT);

  /** Resolve :username to an active user id, or 404. */
  async function targetId(request: FastifyRequest): Promise<string> {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
    }
    const db = getDb();
    const id = await findUserIdByUsername(db, parsed.data.username);
    if (!id) {
      throw new AppError(404, 'NOT_FOUND', 'Profile not found.');
    }
    return id;
  }

  app.post('/users/:username/follow', { preHandler: mutateLimiter }, async (request) => {
    const me = await requireAuth(request);
    const id = await targetId(request);
    const result = await followUser(getDb(), me.id, id, request.id);
    return successBody(request, result);
  });

  app.delete('/users/:username/follow', { preHandler: mutateLimiter }, async (request) => {
    const me = await requireAuth(request);
    const id = await targetId(request);
    const result = await unfollowUser(getDb(), me.id, id, request.id);
    return successBody(request, result);
  });

  // Public list reads. `direction` comes from the path, not a query param,
  // so the two lists cannot be confused for one another.
  app.get('/users/:username/followers', { preHandler: listLimiter }, async (request) => {
    const id = await targetId(request);
    const viewer = await optionalUser(request);
    const entries = await listFollows(getDb(), id, directionSchema.parse('followers'), viewer);
    return successBody(request, { followers: entries });
  });

  app.get('/users/:username/following', { preHandler: listLimiter }, async (request) => {
    const id = await targetId(request);
    const viewer = await optionalUser(request);
    const entries = await listFollows(getDb(), id, directionSchema.parse('following'), viewer);
    return successBody(request, { following: entries });
  });
}

export { getFollowCounts, isFollowing };
