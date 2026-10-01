import type { FastifyRequest } from 'fastify';

/**
 * Application error carrying an HTTP status and a stable ARCHITECTURE.md §15
 * code, plus OPTIONAL structured detail.
 *
 * `meta` exists for the Phase 5n-C auto-retry: a pending fee payment has to
 * tell the client "2 of 3 confirmations" as DATA so the client can render
 * "Confirming 2/3…" and keep polling, rather than parsing it back out of a
 * human sentence. It is emitted ONLY when present, so every existing error
 * response keeps its exact `{ error: { code, message }, requestId }` shape
 * and no consumer has to change.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly meta?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (meta !== undefined) {
      this.meta = meta;
    }
  }
}

export function requestIdOf(request: FastifyRequest): string {
  return typeof request.id === 'string' && request.id.length > 0 ? request.id : 'unknown';
}

/** Success envelope: { data, requestId }. Returned from async handlers. */
export function successBody(request: FastifyRequest, data: unknown): unknown {
  return { data, requestId: requestIdOf(request) };
}

/**
 * Error envelope: { error: { code, message, meta? }, requestId }. Never
 * includes stacks. `meta` is omitted entirely when undefined, so the shape
 * is byte-identical to before for every error that does not use it.
 */
export function errorBody(
  request: FastifyRequest,
  code: string,
  message: string,
  meta?: Record<string, unknown>,
): unknown {
  const error = meta === undefined ? { code, message } : { code, message, meta };
  return { error, requestId: requestIdOf(request) };
}
