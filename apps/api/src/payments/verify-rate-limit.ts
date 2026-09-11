// Phase 8: per-claim verification rate limiter. Scope is the claim (not the
// IP): at most one chain lookup per claim per window. Backed by an in-memory
// map — correct for the deployed single-region MVP (same standing note as the
// auth limiters); a multi-instance deployment would need shared storage.
export interface VerifyRateLimitOptions {
  windowMs: number;
}

export const DEFAULT_VERIFY_RATE_LIMIT: VerifyRateLimitOptions = { windowMs: 5_000 };

export interface VerifyRateLimitDecision {
  allowed: boolean;
  /** Whole seconds the client must wait (present when denied). Minimum 1. */
  retryAfterSeconds?: number;
}

/** Fixed-window per-claim limiter. Check-and-record is synchronous (atomic). */
export function createVerifyRateLimiter(options: VerifyRateLimitOptions = DEFAULT_VERIFY_RATE_LIMIT) {
  const lastSeen = new Map<string, number>();

  function check(claimId: string, now: number = Date.now()): VerifyRateLimitDecision {
    if (lastSeen.size > 10000) {
      for (const [key, at] of lastSeen) {
        if (at + options.windowMs <= now) {
          lastSeen.delete(key);
        }
      }
    }
    const previous = lastSeen.get(claimId);
    if (previous !== undefined && now - previous < options.windowMs) {
      const waitMs = previous + options.windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    lastSeen.set(claimId, now);
    return { allowed: true };
  }

  return { check };
}

export type VerifyRateLimiter = ReturnType<typeof createVerifyRateLimiter>;
