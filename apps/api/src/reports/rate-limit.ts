// Per-user report creation budget — 5 reports per hour per user.
// Exceeding yields 429 REPORT_RATE_LIMITED. In-memory (same single-region
// standing note as the auth limiters). Only successful creations consume the
// budget: validation failures do not lock a user out.
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

const hits = new Map<string, number[]>();

export function checkReportRateLimit(userId: string, now: number = Date.now()): boolean {
  const list = hits.get(userId) ?? [];
  const fresh = list.filter((t) => t > now - WINDOW_MS);
  hits.set(userId, fresh);
  return fresh.length < MAX_PER_WINDOW;
}

export function recordReportCreation(userId: string, now: number = Date.now()): void {
  const list = hits.get(userId) ?? [];
  const fresh = list.filter((t) => t > now - WINDOW_MS);
  fresh.push(now);
  hits.set(userId, fresh);
}

/** Test seam: clear all budgets (tests use fresh users; this is a backstop). */
export function resetReportRateLimiter(): void {
  hits.clear();
}
