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
  DEFAULT_USERNAME_SET_RATE_LIMIT,
  type RateLimitOptions,
} from '../http/rate-limit';
import { nullableImageDataField } from '../images/validation';
import { setUserAvatar, setUsernameOnce, updateUserProfile } from '../users/service';
import { userProfileBodySchema, usernameSetBodySchema } from '../users/validation';
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
    /** Per-IP profile-scalars update budget (default 60/min). */
    profile?: RateLimitOptions;
    /** Per-user one-time username set budget (default 10/hour). */
    usernameSet?: RateLimitOptions;
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
  const userProfileLimiter = createRateLimiter(
    opts.rateLimit?.profile ?? DEFAULT_PROVIDER_PROFILE_RATE_LIMIT,
  );
  // Per-USER, and separate from userProfileLimiter: the set budget is 10/hour
  // (one lifetime action) and must not be shared with 60/min of scalar edits.
  const usernameSetLimiter = createUserRateLimiter(
    opts.rateLimit?.usernameSet ?? DEFAULT_USERNAME_SET_RATE_LIMIT,
  );

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

  // Self-service profile scalars (Phase 5j onboarding): bio, phone, dob,
  // location. All optional; absent = unchanged, null/'' = clear. DOB and
  // phone are private (stored, never served on public projections).
  app.patch('/me/profile', { preHandler: userProfileLimiter }, async (request) => {
    const user = await requireAuth(request);
    const parsed = userProfileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid profile fields.';
      throw new AppError(400, 'INVALID_INPUT', message);
    }
    const db = getDb();
    const profile = await updateUserProfile(db, user.id, parsed.data, {
      requestId: request.id,
    });
    return successBody(request, { profile });
  });

  // Phase 5o-A (D26): claim a public handle, exactly once, for an account that
  // never had one (the wallet signup path). Deliberately NOT a field on
  // /me/profile — see usernameSetBodySchema for why (per-user budget, its own
  // audit event, its own immutability rule). Idempotent for the SAME handle;
  // 409 USERNAME_IMMUTABLE for a different one, 409 USERNAME_TAKEN when the
  // handle is already owned, 400 INVALID_INPUT for format/reserved.
  app.patch('/me/username', { preHandler: usernameSetLimiter }, async (request) => {
    const user = await requireAuth(request);
    const parsed = usernameSetBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'INVALID_INPUT', 'Enter a username.');
    }
    const db = getDb();
    const result = await setUsernameOnce(db, user.id, parsed.data.username, {
      requestId: request.id,
    });
    return successBody(request, {
      username: result.username,
      alreadySet: result.alreadySet,
    });
  });
}
