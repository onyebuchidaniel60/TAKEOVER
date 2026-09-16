import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ESCROW_DELIVERY_WINDOW_SECONDS,
  DEFAULT_ESCROW_DEPOSIT_VERIFICATION_SECONDS,
  DEFAULT_ESCROW_DISPUTE_WINDOW_SECONDS,
  DEFAULT_ESCROW_REFUND_CONFIRMATIONS,
  DEFAULT_ESCROW_RELEASE_CONFIRMATIONS,
  getEscrowDeliveryWindowSeconds,
  getEscrowDepositVerificationSeconds,
  getEscrowDisputeWindowSeconds,
  getEscrowRefundConfirmations,
  getEscrowReleaseConfirmations,
  loadEnv,
  parseEnv,
} from '../src/env';

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

  it('deposit-verification window getter defaults tolerantly and parses set values', () => {
    expect(DEFAULT_ESCROW_DEPOSIT_VERIFICATION_SECONDS).toBe(1800);
    expect(getEscrowDepositVerificationSeconds({})).toBe(1800);
    expect(getEscrowDepositVerificationSeconds({ ESCROW_DEPOSIT_VERIFICATION_SECONDS: '' })).toBe(1800);
    expect(getEscrowDepositVerificationSeconds({ ESCROW_DEPOSIT_VERIFICATION_SECONDS: 'garbage' })).toBe(1800);
    expect(getEscrowDepositVerificationSeconds({ ESCROW_DEPOSIT_VERIFICATION_SECONDS: '0' })).toBe(1800);
    expect(getEscrowDepositVerificationSeconds({ ESCROW_DEPOSIT_VERIFICATION_SECONDS: '-5' })).toBe(1800);
    expect(getEscrowDepositVerificationSeconds({ ESCROW_DEPOSIT_VERIFICATION_SECONDS: '900' })).toBe(900);
    expect(parseEnv({ ESCROW_DEPOSIT_VERIFICATION_SECONDS: '900' })).toMatchObject({
      ESCROW_DEPOSIT_VERIFICATION_SECONDS: 900,
    });
  });

  it('delivery window getter defaults tolerantly and parses set values', () => {
    expect(DEFAULT_ESCROW_DELIVERY_WINDOW_SECONDS).toBe(86400);
    expect(getEscrowDeliveryWindowSeconds({})).toBe(86400);
    expect(getEscrowDeliveryWindowSeconds({ ESCROW_DELIVERY_WINDOW_SECONDS: '' })).toBe(86400);
    expect(getEscrowDeliveryWindowSeconds({ ESCROW_DELIVERY_WINDOW_SECONDS: 'garbage' })).toBe(86400);
    expect(getEscrowDeliveryWindowSeconds({ ESCROW_DELIVERY_WINDOW_SECONDS: '0' })).toBe(86400);
    expect(getEscrowDeliveryWindowSeconds({ ESCROW_DELIVERY_WINDOW_SECONDS: '-5' })).toBe(86400);
    expect(getEscrowDeliveryWindowSeconds({ ESCROW_DELIVERY_WINDOW_SECONDS: '3600' })).toBe(3600);
    expect(parseEnv({ ESCROW_DELIVERY_WINDOW_SECONDS: '3600' })).toMatchObject({
      ESCROW_DELIVERY_WINDOW_SECONDS: 3600,
    });
  });

  it('dispute window getter defaults tolerantly and parses set values', () => {
    expect(DEFAULT_ESCROW_DISPUTE_WINDOW_SECONDS).toBe(86400);
    expect(getEscrowDisputeWindowSeconds({})).toBe(86400);
    expect(getEscrowDisputeWindowSeconds({ ESCROW_DISPUTE_WINDOW_SECONDS: '' })).toBe(86400);
    expect(getEscrowDisputeWindowSeconds({ ESCROW_DISPUTE_WINDOW_SECONDS: 'garbage' })).toBe(86400);
    expect(getEscrowDisputeWindowSeconds({ ESCROW_DISPUTE_WINDOW_SECONDS: '0' })).toBe(86400);
    expect(getEscrowDisputeWindowSeconds({ ESCROW_DISPUTE_WINDOW_SECONDS: '-5' })).toBe(86400);
    expect(getEscrowDisputeWindowSeconds({ ESCROW_DISPUTE_WINDOW_SECONDS: '3600' })).toBe(3600);
    expect(parseEnv({ ESCROW_DISPUTE_WINDOW_SECONDS: '3600' })).toMatchObject({
      ESCROW_DISPUTE_WINDOW_SECONDS: 3600,
    });
  });

  it('release confirmations getter defaults tolerantly and parses set values', () => {
    expect(DEFAULT_ESCROW_RELEASE_CONFIRMATIONS).toBe(3);
    expect(getEscrowReleaseConfirmations({})).toBe(3);
    expect(getEscrowReleaseConfirmations({ ESCROW_RELEASE_CONFIRMATIONS: '' })).toBe(3);
    expect(getEscrowReleaseConfirmations({ ESCROW_RELEASE_CONFIRMATIONS: 'garbage' })).toBe(3);
    expect(getEscrowReleaseConfirmations({ ESCROW_RELEASE_CONFIRMATIONS: '0' })).toBe(3);
    expect(getEscrowReleaseConfirmations({ ESCROW_RELEASE_CONFIRMATIONS: '-2' })).toBe(3);
    expect(getEscrowReleaseConfirmations({ ESCROW_RELEASE_CONFIRMATIONS: '6' })).toBe(6);
    expect(parseEnv({ ESCROW_RELEASE_CONFIRMATIONS: '6' })).toMatchObject({
      ESCROW_RELEASE_CONFIRMATIONS: 6,
    });
  });

  it('refund confirmations getter defaults tolerantly and parses set values', () => {
    expect(DEFAULT_ESCROW_REFUND_CONFIRMATIONS).toBe(3);
    expect(getEscrowRefundConfirmations({})).toBe(3);
    expect(getEscrowRefundConfirmations({ ESCROW_REFUND_CONFIRMATIONS: '' })).toBe(3);
    expect(getEscrowRefundConfirmations({ ESCROW_REFUND_CONFIRMATIONS: 'garbage' })).toBe(3);
    expect(getEscrowRefundConfirmations({ ESCROW_REFUND_CONFIRMATIONS: '0' })).toBe(3);
    expect(getEscrowRefundConfirmations({ ESCROW_REFUND_CONFIRMATIONS: '-2' })).toBe(3);
    expect(getEscrowRefundConfirmations({ ESCROW_REFUND_CONFIRMATIONS: '6' })).toBe(6);
    expect(parseEnv({ ESCROW_REFUND_CONFIRMATIONS: '6' })).toMatchObject({
      ESCROW_REFUND_CONFIRMATIONS: 6,
    });
  });
});
