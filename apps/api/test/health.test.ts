import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

describe('GET /health', () => {
  it('returns 200 with { status: "ok" } and needs no database', async () => {
    const app = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('returns 404 for unknown routes', async () => {
    const app = buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/nope' });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
