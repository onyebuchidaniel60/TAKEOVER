// Admin identity. ADMIN_WALLET_ADDRESSES (comma-separated canonical
// Nimiq addresses) is the source of truth. Role is persisted in users.role;
// updating the env requires the admin to re-authenticate (promotion happens
// on POST /auth/verify). Never auto-demote: a wallet absent from the list
// keeps whatever role it already has.
import { canonicalizeNimiqAddress, InvalidAddressError } from './nimiq-address';
import { requireAuth, type AuthUser } from './session';
import { AppError } from '../http/errors';
import type { FastifyRequest } from 'fastify';

/**
 * Parse the admin allowlist into canonical wallets. Invalid entries are
 * ignored (fail-closed for that entry, not fatal for boot). Empty/unset
 * yields an empty list — nobody is admin.
 */
export function parseAdminWallets(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string[] {
  const raw = env.ADMIN_WALLET_ADDRESSES;
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return [];
  }
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      const canonical = canonicalizeNimiqAddress(trimmed);
      if (!out.includes(canonical)) {
        out.push(canonical);
      }
    } catch (err) {
      if (err instanceof InvalidAddressError) {
        continue;
      }
      throw err;
    }
  }
  return out;
}

/** True when the canonical wallet is in the admin allowlist. */
export function isAdminWallet(
  canonicalWallet: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return parseAdminWallets(env).includes(canonicalWallet);
}

/**
 * Admin guard — sits after requireAuth. No session (or a disabled account)
 * → 401 via requireAuth (ACCOUNT_DISABLED for disabled, UNAUTHENTICATED
 * otherwise). Session but not admin → 403 FORBIDDEN. Admin endpoints do not
 * hide their existence (never 404 for non-admins).
 */
export async function requireAdmin(request: FastifyRequest): Promise<AuthUser> {
  const user = await requireAuth(request);
  if (user.role !== 'admin') {
    throw new AppError(403, 'FORBIDDEN', 'Admin access required.');
  }
  return user;
}
