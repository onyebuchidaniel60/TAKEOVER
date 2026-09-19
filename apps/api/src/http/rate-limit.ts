import type { FastifyRequest } from 'fastify';
import { AppError } from './errors';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

// MVP defaults: 10 challenge/verify attempts per IP per minute. In-memory only —
// a multi-instance deployment would need shared storage (documented for later phases).
export const DEFAULT_CHALLENGE_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 10 };
export const DEFAULT_VERIFY_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 10 };

// Every other mutating endpoint gets a budget (exact values are
// configuration per ARCHITECTURE.md s14, not business rules).
// Claim creation is per-IP: it bounds availability-probing bursts from one origin.
// Slot creation is per-USER (see createUserRateLimiter): it bounds spam listings
// from one account even across IPs. Owner mutations and the provider demand view
// are per-IP tripwires; admin routes sit behind admin auth + audit, so their
// limiter is a generous backstop only.
export const DEFAULT_CLAIM_CREATE_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 };
export const DEFAULT_SLOT_CREATE_RATE_LIMIT: RateLimitOptions = { windowMs: 3_600_000, max: 30 };
export const DEFAULT_SLOT_MUTATE_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 };
export const DEFAULT_PROVIDER_PROFILE_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 };
export const DEFAULT_PROVIDER_CLAIMS_READ_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60_000,
  max: 120,
};
export const DEFAULT_ADMIN_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 120 };
export const DEFAULT_NOTIFICATIONS_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 };

/** Fixed-window per-IP limiter. Throws 429 RATE_LIMITED when the budget is spent. */
export function createRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async function rateLimit(request: FastifyRequest): Promise<void> {
    const now = Date.now();
    if (hits.size > 10000) {
      for (const [key, entry] of hits) {
        if (entry.resetAt <= now) {
          hits.delete(key);
        }
      }
    }
    const key = request.ip;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > options.max) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
    }
  };
}

/**
 * Fixed-window per-USER limiter. The key is the authenticated user id, so one
 * account cannot spread abuse across IPs; unauthenticated callers fall back to
 * the per-IP key (they are rejected by requireAuth anyway — the limiter only
 * bounds how fast they can knock). Throws 429 RATE_LIMITED when spent.
 * Must run after sessionMiddleware (it does: route preHandlers run after the
 * api-scoped onRequest hook that populates request.user).
 */
export function createUserRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async function rateLimit(request: FastifyRequest): Promise<void> {
    const now = Date.now();
    if (hits.size > 10000) {
      for (const [key, entry] of hits) {
        if (entry.resetAt <= now) {
          hits.delete(key);
        }
      }
    }
    const key = request.user?.id ?? request.ip;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + options.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > options.max) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
    }
  };
}
