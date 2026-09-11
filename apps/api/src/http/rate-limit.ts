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
