// Same-origin API client (dev: Vite proxies /api to the Fastify backend).
// Cookies (takeover_session) ride along via credentials: 'include'.

export interface ApiErrorEnvelope {
  error: { code: string; message: string };
  requestId: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  /** Milliseconds from a `Retry-After` response header (seconds form), if present. */
  readonly retryAfterMs?: number;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (raw === null) return undefined;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Phase 12 completion (F4): the server requires X-Takeover-Client on
  // credentialed mutations. Send it on state-changing methods only — never
  // on GET — so plain navigation and preflight-free reads stay untouched,
  // while any cross-origin mutation attempt forces a CORS-gated preflight.
  const method = (init?.method ?? 'GET').toUpperCase();
  const mutating = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(mutating ? { 'X-Takeover-Client': 'web' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const requestId = res.headers.get('x-request-id') ?? undefined;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const err = (body as ApiErrorEnvelope | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `Request failed (${res.status}).`,
      requestId,
      parseRetryAfterMs(res),
    );
  }
  return (body as { data: T }).data;
}
