import { z } from 'zod';

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
  POLYGON_RPC_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  USDT_ESCROW_CONTRACT_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  USDT_TOKEN_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  ESCROW_SIGNER_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  NIM_ESCROW_WALLET_ADDRESS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

export type Env = z.infer<typeof envSchema>;

// Pure parser: throws a ZodError on invalid values (used by tests and later phases).
export function parseEnv(input: Record<string, string | undefined>): Env {
  return envSchema.parse(input);
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
 * (Phase 10 decides); the buyer might have paid.
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
 * existing escrow vars. Phase 14d-2 only sets delivery_deadline on verified
 * deposit; enforcement (release/refund) is 14d-3+.
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

// Phase 1 policy: warn but never hard-fail the API when optional
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
