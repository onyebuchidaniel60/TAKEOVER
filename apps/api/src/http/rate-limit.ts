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
// Avatar uploads are more expensive than reads (200KB writes): 10 per user per hour.
export const DEFAULT_AVATAR_RATE_LIMIT: RateLimitOptions = { windowMs: 3_600_000, max: 10 };
export const DEFAULT_PROVIDER_CLAIMS_READ_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60_000,
  max: 120,
};
export const DEFAULT_ADMIN_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 120 };
export const DEFAULT_NOTIFICATIONS_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 };
// Phase 5g email identity budgets: registration is a strict per-IP hourly
// budget (signup-abuse backstop behind the EMAIL_TAKEN usability signal);
// login is per-IP per 15 minutes plus a smaller per-email budget counted
// on FAILURES only (stops targeted brute force without locking legitimate
// retries out of a shared IP); username-available is a live-typing
// endpoint (generous per-minute tripwire, not a hard user cap).
export const DEFAULT_REGISTER_RATE_LIMIT: RateLimitOptions = { windowMs: 3_600_000, max: 5 };
export const DEFAULT_LOGIN_RATE_LIMIT: RateLimitOptions = { windowMs: 15 * 60_000, max: 10 };
export const DEFAULT_LOGIN_EMAIL_FAILURE_RATE_LIMIT: RateLimitOptions = {
  windowMs: 15 * 60_000,
  max: 5,
};
export const DEFAULT_USERNAME_AVAILABLE_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60_000,
  max: 30,
};

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
 * Keyed fixed-window budget. Unlike the request-keyed limiters above, the
 * caller supplies the bucket key explicitly (e.g. a normalized email for
 * failures-only login tracking, where the outcome — and therefore the key
 * lifetime — is known only inside the handler). Throws 429 RATE_LIMITED
 * when the key's budget is spent; each consume() call counts one unit.
 */
export function createKeyedRateLimiter(options: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    consume(key: string): void {
      const now = Date.now();
      if (hits.size > 10000) {
        for (const [stored, entry] of hits) {
          if (entry.resetAt <= now) {
            hits.delete(stored);
          }
        }
      }
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + options.windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > options.max) {
        throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
      }
    },
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
