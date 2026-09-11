import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { sessionCookieOptions } from '../src/auth/session';
import { DEV_CORS_ORIGIN, parseCorsOrigins } from '../src/env';

// Phase 3 completion: locked Vercel -> Railway cross-origin topology.
// Cookies must be Lax/insecure in dev and None/Secure in prod (HttpOnly always).
// CORS must use an explicit allowlist with credentials, never a wildcard.
describe('auth cookies (dev vs prod)', () => {
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
  });

  it('uses Lax + insecure HttpOnly cookies in dev', () => {
    process.env.NODE_ENV = 'test';
    expect(sessionCookieOptions()).toEqual({
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
  });

  it('uses None + Secure HttpOnly cookies in production', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieOptions()).toEqual({
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });
  });
});

describe('CORS allowlist', () => {
  it('defaults to the local Vite origin outside production', () => {
    expect(parseCorsOrigins({})).toEqual([DEV_CORS_ORIGIN]);
    expect(DEV_CORS_ORIGIN).toBe('http://localhost:5173');
  });

  it('parses a comma-separated CORS_ORIGINS allowlist', () => {
    expect(
      parseCorsOrigins({ CORS_ORIGINS: 'https://a.vercel.app, https://b.vercel.app ' }),
    ).toEqual(['https://a.vercel.app', 'https://b.vercel.app']);
  });

  it('is empty in production when CORS_ORIGINS is unset (fail closed)', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(parseCorsOrigins({})).toEqual([]);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('succeeds for an allowlisted origin with credentials', async () => {
    const app = buildApp({ corsOrigins: ['https://takeover.vercel.app'] });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://takeover.vercel.app' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://takeover.vercel.app');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    } finally {
      await app.close();
    }
  });

  it('fails closed for a non-allowlisted origin requesting credentials', async () => {
    const app = buildApp({ corsOrigins: ['https://takeover.vercel.app'] });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://evil.example' },
      });
      expect(res.statusCode).toBe(200);
      // No CORS grant: the browser must not expose the response cross-origin.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('never emits a wildcard origin when credentials are enabled', async () => {
    const app = buildApp({ corsOrigins: ['https://takeover.vercel.app'] });
    try {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/health',
        headers: {
          origin: 'https://takeover.vercel.app',
          'access-control-request-method': 'GET',
        },
      });
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    } finally {
      await app.close();
    }
  });
});
