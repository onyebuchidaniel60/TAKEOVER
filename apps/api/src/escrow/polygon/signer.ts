// Phase 14d-3a: server-side Polygon escrow signer (USDT release path).
//
// First server-side private key introduced in this project. Handling rules:
// - Loaded lazily (only on the first release attempt), then cached.
// - NEVER logged, stringified, returned in any API response, or committed.
//   Error messages are generic and never embed key material.
// - The derived address is cross-checked against ESCROW_SIGNER_ADDRESS when
//   set; mismatch fails closed.
// - Production gap (documented): env secret for the competition build; KMS
//   in production.
//
// Only the Polygon client implementation imports this module. No route,
// service, or test imports the key — tests assert behavior through
// loadEscrowSigner and a source scan.
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';

export type EscrowSignerAccount = PrivateKeyAccount;

/** Thrown for missing/malformed key or address mismatch. The service maps it to 503 ESCROW_RELEASE_FAILED. */
export class EscrowSignerUnavailableError extends Error {
  constructor(message = 'Escrow signer is temporarily unavailable.') {
    super(message);
    this.name = 'EscrowSignerUnavailableError';
  }
}

let cached: { raw: string; account: EscrowSignerAccount } | null = null;

/** Test seam: drop the cached account so env changes take effect between cases. */
export function resetEscrowSignerCache(): void {
  cached = null;
}

function readPrivateKey(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string {
  const raw = env.ESCROW_SIGNER_PRIVATE_KEY;
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new EscrowSignerUnavailableError();
  }
  const trimmed = raw.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return `0x${trimmed}`;
  }
  throw new EscrowSignerUnavailableError();
}

/**
 * Lazily load (and cache) the escrow signer account. Validates 32-byte hex,
 * derives the address with viem, and cross-checks it against
 * ESCROW_SIGNER_ADDRESS when set. Throws EscrowSignerUnavailableError on any
 * failure — never throws the key itself, never logs it.
 */
export function loadEscrowSigner(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): EscrowSignerAccount {
  const raw = readPrivateKey(env);
  if (cached && cached.raw === raw) {
    return cached.account;
  }
  let account: EscrowSignerAccount;
  try {
    account = privateKeyToAccount(raw as `0x${string}`);
  } catch {
    throw new EscrowSignerUnavailableError();
  }
  const expected = env.ESCROW_SIGNER_ADDRESS;
  if (typeof expected === 'string' && expected.trim() !== '') {
    if (account.address.toLowerCase() !== expected.trim().toLowerCase()) {
      throw new EscrowSignerUnavailableError();
    }
  }
  cached = { raw, account };
  return account;
}
