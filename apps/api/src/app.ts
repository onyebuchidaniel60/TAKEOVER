import Fastify, { type FastifyInstance } from 'fastify';

// Phase 1: infrastructure health only.
// No DB dependency, no auth, no domain routes yet (later phases).
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
