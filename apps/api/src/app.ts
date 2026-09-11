import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { sessionMiddleware } from './auth/session';
import { AppError, errorBody } from './http/errors';
import { authRoutes, type AuthRouteOptions } from './routes/auth';

export type AppOptions = AuthRouteOptions;

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: true,
    // Behind Railway/Vercel the app sits behind a proxy; req.ip (rate limiting)
    // relies on X-Forwarded-For.
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  void app.register(cookie);

  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-request-id', request.id);
    return payload;
  });

  // Infrastructure health: plain shape, no DB, no session work.
  app.get('/health', async () => ({ status: 'ok' }));

  // Versioned API: enveloped JSON, session resolution, auth routes.
  void app.register(
    async (api) => {
      api.addHook('onRequest', sessionMiddleware);
      await api.register(authRoutes, opts);
    },
    { prefix: '/api/v1' },
  );

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send(errorBody(request, 'NOT_FOUND', 'Not found.'));
  });

  app.setErrorHandler((error, request, reply) => {
    if (reply.sent) {
      return;
    }
    if (error instanceof AppError) {
      void reply.code(error.statusCode).send(errorBody(request, error.code, error.message));
      return;
    }
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    if (statusCode === 400 || statusCode === 413 || statusCode === 415) {
      // Malformed JSON, oversized bodies, wrong content type: safe client errors.
      void reply
        .code(statusCode)
        .send(
          errorBody(
            request,
            'INVALID_INPUT',
            statusCode === 413 ? 'Request body too large.' : 'Invalid request.',
          ),
        );
      return;
    }
    // Never leak stacks or DB internals; the request id + server log carry the detail.
    request.log.error(error);
    void reply.code(500).send(errorBody(request, 'INTERNAL_ERROR', 'Something went wrong.'));
  });

  return app;
}
