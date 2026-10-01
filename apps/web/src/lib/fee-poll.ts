// Listing-fee auto-retry loop (Phase 5n-C, D24).
//
// Pure and framework-free on purpose: the timing policy is business logic,
// and the AGENTS.md rule is that it does not live inside a UI component.
// SellDetail renders the states; this decides the cadence.
//
// Model: the fee is ONE payment, so every attempt re-posts the SAME hash.
// A publish is therefore a status read dressed as a mutation, and the
// backend stays authoritative on each attempt — this loop never decides a
// payment is good, it only decides when to ask again.
//
// Outcomes:
//   - 2xx                        -> 'published'
//   - 409 PAYMENT_NOT_CONFIRMED  -> wait `intervalMs`, ask again
//   - 409 PAYMENT_NOT_FOUND      -> same (propagation delay, not a problem)
//   - 503 RPC_UNAVAILABLE        -> wait `backoffMs`; the chain read is the
//                                   flaky part, not the payment
//   - any other code             -> 'failed' (mismatch/replay/invalid can
//                                   never publish; retrying is pointless)
//   - budget exhausted           -> 'handover' (the hash is already on the
//                                   slot row, so the publish still lands)
export type PollOutcome = 'published' | 'failed' | 'handover';

const RETRYABLE = new Set(['PAYMENT_NOT_CONFIRMED', 'PAYMENT_NOT_FOUND']);
const BACKOFF_CODE = 'RPC_UNAVAILABLE';

export interface PollDeps {
  hash: string;
  /** One publish attempt. Resolves to something shaped like a Response. */
  attempt: () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  intervalMs: number;
  backoffMs: number;
  totalMs: number;
  now: () => number;
  setTimeoutFn: (fn: () => void, ms: number) => number;
  clearTimeoutFn: (handle: number) => void;
}

/** Reads `error.code` out of the failure envelope, if present. */
async function codeOf(res: { json: () => Promise<unknown> }): Promise<string> {
  return res
    .json()
    .then((body) => {
      const err = (body as { error?: { code?: string } } | null)?.error;
      return typeof err?.code === 'string' ? err.code : '';
    })
    .catch(() => '');
}

export async function pollUntilPublished(deps: PollDeps): Promise<PollOutcome> {
  const deadline = deps.now() + deps.totalMs;
  // First attempt is immediate: this is called right after a broadcast.
  for (;;) {
    let res: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      res = await deps.attempt();
    } catch {
      // A network-level throw is treated like an RPC outage: slow down and
      // keep asking, because the payment may well be fine.
      res = { ok: false, status: 0, json: () => Promise.resolve({}) };
    }
    if (res.ok) return 'published';

    const code = await codeOf(res);
    if (code === BACKOFF_CODE || (code === '' && res.status >= 500)) {
      // fall through to the backoff delay below
    } else if (!RETRYABLE.has(code)) {
      return 'failed';
    }

    if (deps.now() >= deadline) return 'handover';
    const delay = code === BACKOFF_CODE || (code === '' && res.status >= 500)
      ? deps.backoffMs
      : deps.intervalMs;
    await new Promise<void>((resolve) => {
      const handle = deps.setTimeoutFn(resolve, delay);
      // Swallow the handle: the promise resolves when the timer fires.
      void handle;
    });
  }
}
