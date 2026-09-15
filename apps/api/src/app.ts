import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { sessionMiddleware } from './auth/session';
import { parseCorsOrigins } from './env';
import { AppError, errorBody } from './http/errors';
import { createCsrfGuard } from './http/csrf';
import { authRoutes, type AuthRouteOptions } from './routes/auth';
import { adminRoutes, type AdminRouteOptions } from './routes/admin';
import { claimRoutes, type ClaimRouteOptions } from './routes/claims';
import { escrowRoutes, type EscrowRouteOptions } from './routes/escrow';
import { reportRoutes } from './routes/reports';
import { paymentRoutes, type PaymentRouteOptions } from './routes/payments';
import { providerRoutes, type ProviderRouteOptions } from './routes/provider';
import { slotRoutes, type SlotRouteOptions } from './routes/slots';

export type AppOptions = AuthRouteOptions &
  PaymentRouteOptions &
  SlotRouteOptions &
  ClaimRouteOptions &
  ProviderRouteOptions &
  EscrowRouteOptions &
  AdminRouteOptions & {
    /** Explicit CORS allowlist override (tests). Defaults to parseCorsOrigins(). */
    corsOrigins?: string[];
  };

export function buildApp(opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: true,
    // Behind Railway/Vercel the app sits behind a proxy; req.ip (rate limiting)
    // relies on X-Forwarded-For.
    trustProxy: true,
    genReqId: () => randomUUID(),
  });

  // Locked topology: Vercel frontend -> Railway backend (cross-origin).
  // Explicit allowlist from CORS_ORIGINS (comma-separated); credentials:true;
  // never a wildcard origin with credentials. Dev default http://localhost:5173;
  // production from env only (empty = fail closed).
  const corsAllowlist = opts.corsOrigins ?? parseCorsOrigins();
  void app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      if (corsAllowlist.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    // Explicit method list: the @fastify/cors default is only GET,HEAD,POST,
    // which blocks PATCH preflights (Phase 14b). Keep all methods the API
    // uses plus near-term verbs; origin allowlist + credentials unchanged.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  void app.register(cookie);

  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-request-id', request.id);
    return payload;
  });

  // Infrastructure health: plain shape, no DB, no session work.
  app.get('/health', async () => ({ status: 'ok' }));

  // Versioned API: enveloped JSON, session resolution, CSRF guard for
  // credentialed mutations, then auth + slot + claim + payment routes.
  // The CSRF preHandler runs before every route-level preHandler (rate
  // limiters): rejected cross-site mutations never consume rate budget.
  void app.register(
    async (api) => {
      api.addHook('onRequest', sessionMiddleware);
      api.addHook('preHandler', createCsrfGuard(corsAllowlist));
      await api.register(authRoutes, opts);
      await api.register(slotRoutes, opts);
      await api.register(claimRoutes, opts);
      await api.register(paymentRoutes, opts);
      await api.register(escrowRoutes, opts);
      await api.register(providerRoutes, opts);
      await api.register(reportRoutes);
      await api.register(adminRoutes, opts);
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
