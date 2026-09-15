import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';

// Phase 14c round 4: the @fastify/cors default allow-methods is only
// GET,HEAD,POST, which blocked PATCH preflights from the Mini App
// (browser fails at the preflight stage). The app config must allow
// PATCH plus near-term verbs. No DB is touched: preflight is answered
// by the CORS hook before any route runs.
describe('CORS preflight methods', () => {
  const origin = 'https://takeover-web-gamma.vercel.app';

  it('allows PATCH in preflight without regressing GET/POST/OPTIONS (and DELETE)', async () => {
    const app = buildApp({ corsOrigins: [origin] });
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/me/provider-profile',
        headers: {
          origin,
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      const allowMethods = String(res.headers['access-control-allow-methods'] ?? '');
      const methods = allowMethods.split(',').map((m) => m.trim());
      expect(methods).toContain('PATCH');
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
      expect(methods).toContain('OPTIONS');
      expect(methods).toContain('DELETE');
      expect(res.headers['access-control-allow-origin']).toBe(origin);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('still fails closed for an unlisted origin on PATCH preflight', async () => {
    const app = buildApp({ corsOrigins: [origin] });
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/me/provider-profile',
        headers: {
          origin: 'https://evil.example',
          'access-control-request-method': 'PATCH',
          'access-control-request-headers': 'authorization,content-type',
        },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
