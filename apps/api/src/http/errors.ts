import type { FastifyRequest } from 'fastify';

/** Application error carrying an HTTP status and a stable ARCHITECTURE.md s15 code. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function requestIdOf(request: FastifyRequest): string {
  return typeof request.id === 'string' && request.id.length > 0 ? request.id : 'unknown';
}

/** Success envelope: { data, requestId }. Returned from async handlers. */
export function successBody(request: FastifyRequest, data: unknown): unknown {
  return { data, requestId: requestIdOf(request) };
}

/** Error envelope: { error: { code, message }, requestId }. Never includes stacks. */
export function errorBody(request: FastifyRequest, code: string, message: string): unknown {
  return { error: { code, message }, requestId: requestIdOf(request) };
}
