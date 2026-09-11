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
});

export type Env = z.infer<typeof envSchema>;

// Pure parser: throws a ZodError on invalid values (used by tests and later phases).
export function parseEnv(input: Record<string, string | undefined>): Env {
  return envSchema.parse(input);
}

/** Dev fallback for local Vite (http://localhost:5173). Never used in production. */
export const DEV_CORS_ORIGIN = 'http://localhost:5173';

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
export function loadEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(input);
  if (!result.success) {
    console.warn(
      'Invalid environment configuration; continuing with defaults.',
      result.error.flatten().fieldErrors,
    );
    return {};
  }
  return result.data;
}
