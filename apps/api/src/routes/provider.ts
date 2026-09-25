// Provider self-service profile (display name only).
// All responses use the { data, requestId } envelope; errors use
// { error: { code, message }, requestId }.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDb } from '../../../../db/client';
import { requireAuth } from '../auth/session';
import { AppError, successBody } from '../http/errors';
import {
  createRateLimiter,
  createUserRateLimiter,
  DEFAULT_AVATAR_RATE_LIMIT,
  DEFAULT_PROVIDER_PROFILE_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';
import { nullableImageDataField } from '../images/validation';
import { setUserAvatar } from '../users/service';
import { upsertProviderProfile } from '../provider-profiles/service';
import { providerProfileBodySchema } from '../provider-profiles/validation';

// Avatar set-or-clear ({ avatarData: string | null }). Null clears the
// picture. Strict: unknown fields → 400.
const avatarBodySchema = z
  .object({
    avatarData: nullableImageDataField,
  })
  .strict();

export interface ProviderRouteOptions {
  rateLimit?: {
    /** Per-IP display-name update budget (default 60/min). */
    providerProfile?: RateLimitOptions;
    /** Per-user avatar upload budget (default 10/hour). */
    avatar?: RateLimitOptions;
  };
}

export async function providerRoutes(
  app: FastifyInstance,
  opts: ProviderRouteOptions = {},
): Promise<void> {
  const profileLimiter = createRateLimiter(
    opts.rateLimit?.providerProfile ?? DEFAULT_PROVIDER_PROFILE_RATE_LIMIT,
  );
  const avatarLimiter = createUserRateLimiter(opts.rateLimit?.avatar ?? DEFAULT_AVATAR_RATE_LIMIT);

  app.patch('/me/provider-profile', { preHandler: profileLimiter }, async (request) => {
    const user = await requireAuth(request);
    const parsed = providerProfileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Invalid display name.');
    }
    const db = getDb();
    const providerProfile = await upsertProviderProfile(db, {
      userId: user.id,
      displayName: parsed.data.display_name,
    });
    return successBody(request, { providerProfile });
  });

  app.patch('/me/avatar', { preHandler: avatarLimiter }, async (request) => {
    const user = await requireAuth(request);
    const parsed = avatarBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        400,
        'INVALID_INPUT',
        'Avatar must be a JPEG, PNG, or WebP data URI of 200KB or less. Use null to clear it.',
      );
    }
    const db = getDb();
    const avatarData = await setUserAvatar(db, user.id, parsed.data.avatarData, {
      requestId: request.id,
    });
    return successBody(request, { avatarData });
  });
}
