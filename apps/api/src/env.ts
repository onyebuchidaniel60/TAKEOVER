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
});

export type Env = z.infer<typeof envSchema>;

// Pure parser: throws a ZodError on invalid values (used by tests and later phases).
export function parseEnv(input: Record<string, string | undefined>): Env {
  return envSchema.parse(input);
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
