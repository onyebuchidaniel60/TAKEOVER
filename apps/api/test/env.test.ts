import { describe, expect, it } from 'vitest';
import { loadEnv, parseEnv } from '../src/env';

describe('env validation', () => {
  it('accepts missing optional configuration without throwing', () => {
    expect(parseEnv({})).toEqual({});
  });

  it('treats empty strings as missing (matches .env.example placeholders)', () => {
    expect(parseEnv({ DATABASE_URL: '', NIMIQ_RPC_URL: '' })).toEqual({});
  });

  it('accepts a fully populated valid configuration', () => {
    expect(
      parseEnv({
        DATABASE_URL: 'postgres://user:pass@localhost:5432/takeover',
        SESSION_SECRET: 'secret',
        NIMIQ_RPC_URL: 'https://rpc.example.com',
        NIMIQ_NETWORK: 'testnet',
        ADMIN_WALLET_ADDRESSES: 'NQxx',
        SENTRY_DSN: 'https://example.com/1',
        PORT: '3001',
      }),
    ).toMatchObject({ NIMIQ_NETWORK: 'testnet', PORT: 3001 });
  });

  it('rejects malformed URLs', () => {
    expect(() => parseEnv({ NIMIQ_RPC_URL: 'not-a-url' })).toThrow();
  });

  it('loadEnv never throws and falls back to defaults on invalid input', () => {
    expect(loadEnv({ NIMIQ_RPC_URL: 'not-a-url' })).toEqual({});
  });
});
