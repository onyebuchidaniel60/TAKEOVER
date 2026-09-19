import { z } from 'zod';
import { canonicalizeNimiqAddress, InvalidAddressError } from './auth/nimiq-address';
import { nimFromBaseUnits, nimToBaseUnits } from './payments/amounts';

// Empty .env.example placeholders ("KEY=") parse as "" — treat them as missing.
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const envSchema = z.object({
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  NIMIQ_RPC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  NIMIQ_NETWORK: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ADMIN_WALLET_ADDRESSES: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  CORS_ORIGINS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  CLAIM_HOLD_TTL_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  PAYMENT_REVIEW_TIMEOUT_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  ESCROW_DEPOSIT_VERIFICATION_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  ESCROW_DELIVERY_WINDOW_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  ESCROW_DISPUTE_WINDOW_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  ESCROW_RELEASE_CONFIRMATIONS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  ESCROW_REFUND_CONFIRMATIONS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  POLYGON_RPC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  POLYGON_BROADCAST_RPC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  USDT_ESCROW_CONTRACT_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  USDT_TOKEN_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ESCROW_SIGNER_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  // Server-side Polygon release signer key. Shape-checked loosely here
  // (strict 32-byte-hex validation lives in the signer module, which fails
  // closed at first release attempt, never at boot).
  ESCROW_SIGNER_PRIVATE_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  // NIM listing fee. Decimal NIM string (e.g. "400") — users
  // never see Luna; the backend converts via nimToBaseUnits. Receive-only
  // fee wallet (never signs; no private key exists server-side).
  LISTING_FEE_NIM: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  TAKEOVER_FEE_WALLET_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export type Env = z.infer<typeof envSchema>;

// Pure parser: throws a ZodError on invalid values (used by tests and later phases).
export function parseEnv(input: Record<string, string | undefined>): Env {
  return envSchema.parse(input);
}

/**
 * Optional broadcast-only Polygon RPC endpoint (read/write
 * split). When set, server-signed broadcasts (release/refund wallet
 * client) use it, while reads (event scans, receipts, chain-id probes)
 * keep using POLYGON_RPC_URL. Unset/blank → undefined, and callers fall
 * back to POLYGON_RPC_URL — byte-identical behavior to before the split.
 */
export function getPolygonBroadcastRpcUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.POLYGON_BROADCAST_RPC_URL;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  return undefined;
}

/** Dev fallback for local Vite (http://localhost:5173). Never used in production. */
export const DEV_CORS_ORIGIN = 'http://localhost:5173';

/** Default claim hold window: 10 minutes (FR-05). Overridable via CLAIM_HOLD_TTL_SECONDS. */
export const DEFAULT_CLAIM_HOLD_TTL_SECONDS = 600;

/**
 * Claim hold TTL in seconds. Tolerant by design: missing, blank, or invalid
 * values fall back to the 600s default instead of crashing the claim path.
 */
export function getClaimHoldTtlSeconds(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.CLAIM_HOLD_TTL_SECONDS;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_CLAIM_HOLD_TTL_SECONDS;
}

/** Default payment_pending window before a still-pending verification ages to review (FR-05: 30 minutes). */
export const DEFAULT_PAYMENT_REVIEW_TIMEOUT_SECONDS = 1800;

/**
 * Payment_pending → payment_review timeout in seconds. Tolerant by design:
 * missing, blank, or invalid values fall back to the 1800s default instead of
 * crashing the verify path. Inventory is NEVER restored on this transition
 * (an admin decides); the buyer might have paid.
 */
export function getPaymentReviewTimeoutSeconds(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.PAYMENT_REVIEW_TIMEOUT_SECONDS;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_PAYMENT_REVIEW_TIMEOUT_SECONDS;
}

/**
 * Deposit-verification window in seconds. Tolerant by design: missing,
 * blank, or invalid values fall back to the 1800s default instead of
 * crashing the escrow path. Applies from deposit_submitted entry; on
 * expiry without a verified deposit the claim ages to payment_review
 * (inventory stays reserved; admin resolves via the review surface).
 */
export const DEFAULT_ESCROW_DEPOSIT_VERIFICATION_SECONDS = 1800;

export function getEscrowDepositVerificationSeconds(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.ESCROW_DEPOSIT_VERIFICATION_SECONDS;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_ESCROW_DEPOSIT_VERIFICATION_SECONDS;
}

/**
 * Delivery window in seconds: funded → delivery deadline. Tolerant by design:
 * missing, blank, or invalid values fall back to the 86400s (24h) default
 * instead of crashing the escrow path. Declared in .env.example alongside the
 * existing escrow vars. 2 only sets delivery_deadline on verified
 * deposit; enforcement (release/refund) is handled by release/refund.
 */
export const DEFAULT_ESCROW_DELIVERY_WINDOW_SECONDS = 86400;

export function getEscrowDeliveryWindowSeconds(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.ESCROW_DELIVERY_WINDOW_SECONDS;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_ESCROW_DELIVERY_WINDOW_SECONDS;
}

/**
 * Dispute window in seconds: delivered → dispute deadline. Tolerant by
 * design: missing, blank, or invalid values fall back to the 86400s (24h)
 * default. Set as dispute_window_ends on mark-delivered; no dispute logic
 * yet, just the deadline.
 */
export const DEFAULT_ESCROW_DISPUTE_WINDOW_SECONDS = 86400;

export function getEscrowDisputeWindowSeconds(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.ESCROW_DISPUTE_WINDOW_SECONDS;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_ESCROW_DISPUTE_WINDOW_SECONDS;
}

/**
 * Release confirmation policy: Polygon confirmations required on the
 * release transaction before claim/escrow flip to released. Default 3 —
 * the established precedent from NIM verification (REQUIRED_CONFIRMATIONS).
 * Tolerant like every other window getter.
 */
export const DEFAULT_ESCROW_RELEASE_CONFIRMATIONS = 3;

export function getEscrowReleaseConfirmations(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.ESCROW_RELEASE_CONFIRMATIONS;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_ESCROW_RELEASE_CONFIRMATIONS;
}

/**
 * Refund confirmation policy: Polygon confirmations required on the
 * refund transaction before claim/escrow flip to refunded. Default 3,
 * mirroring the release policy. Tolerant like every other getter.
 */
export const DEFAULT_ESCROW_REFUND_CONFIRMATIONS = 3;

export function getEscrowRefundConfirmations(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): number {
  const raw = env.ESCROW_REFUND_CONFIRMATIONS;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_ESCROW_REFUND_CONFIRMATIONS;
}

/**
 * NIM listing-fee amount as a normalized decimal NIM string
 * (e.g. "400"). Tolerant by design: missing, blank, or invalid values
 * (garbage, non-positive, >5 decimals — validated via nimToBaseUnits) fall
 * back to undefined (fee not configured) instead of crashing boot.
 */
export function getListingFeeNim(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.LISTING_FEE_NIM;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  try {
    return nimFromBaseUnits(nimToBaseUnits(raw));
  } catch {
    return undefined;
  }
}

/**
 * Receive-only NIM listing-fee wallet (canonical form).
 * Tolerant by design: missing or malformed values (validated via the
 * existing canonicalization helper) fall back to undefined — the fee state
 * then reports misconfigured and publish fails closed (F4).
 */
export function getTakeoverFeeWalletAddress(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.TAKEOVER_FEE_WALLET_ADDRESS;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  try {
    return canonicalizeNimiqAddress(raw);
  } catch (err) {
    if (err instanceof InvalidAddressError) {
      return undefined;
    }
    throw err;
  }
}

export interface ListingFeeState {
  /** True only when BOTH the amount and the wallet are configured. */
  required: boolean;
  /** Normalized decimal NIM string when required, else null. */
  amountNim: string | null;
  /** Canonical fee wallet when required, else null. */
  walletAddress: string | null;
  /** F4: amount set but wallet missing/malformed. Publish fails closed. */
  misconfigured: boolean;
}

/**
 * Single source of truth for the fee gate, shared by the
 * config endpoint and the publish flow. Pure and tolerant — never throws.
 */
export function getListingFeeState(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ListingFeeState {
  const amountNim = getListingFeeNim(env);
  if (amountNim === undefined) {
    return { required: false, amountNim: null, walletAddress: null, misconfigured: false };
  }
  const walletAddress = getTakeoverFeeWalletAddress(env);
  if (walletAddress === undefined) {
    return { required: true, amountNim, walletAddress: null, misconfigured: true };
  }
  return { required: true, amountNim, walletAddress, misconfigured: false };
}

/**
 * Explicit CORS allowlist for the locked Vercel (frontend) -> Railway (backend)
 * cross-origin topology. Read from CORS_ORIGINS (comma-separated).
 * Dev default: http://localhost:5173. Production: from env only (empty when
 * unset — fail closed, no wildcard, no credentials to unlisted origins).
 */
export function parseCorsOrigins(input: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string[] {
  const raw = input.CORS_ORIGINS;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (process.env.NODE_ENV === 'production') {
    return [];
  }
  return [DEV_CORS_ORIGIN];
}

// Startup policy: warn but never hard-fail the API when optional
// configuration is missing or invalid. Stricter requirements arrive
// with the phases that actually need each value.
export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {  const result = envSchema.safeParse(input);
  if (!result.success) {
    console.warn(
      'Invalid environment configuration; continuing with defaults.',
      result.error.flatten().fieldErrors,
    );
    return {};
  }
  return result.data;
}
