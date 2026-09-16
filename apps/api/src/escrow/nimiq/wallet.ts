// Phase 14f P-NIM-1: NIM escrow wallet address resolution (custodial escrow).
//
// Single omnibus wallet for all NIM escrows (D2). This module resolves the
// *address* (public) used in deposit instructions and deposit verification.
// Private-key handling (signing) lands in P-NIM-2; the env getter already
// exists for readiness. Only this module (later: plus the signing path)
// reads the wallet env values; the key is never logged, returned, or
// committed.
import { canonicalizeNimiqAddress, InvalidAddressError } from '../../auth/nimiq-address';
import { getNimEscrowWalletAddress as readWalletAddressEnv } from '../../env';

/** Thrown for a missing/malformed wallet address. The service maps it to an existing 503 code. */
export class EscrowWalletUnavailableError extends Error {
  constructor(message = 'NIM escrow wallet is temporarily unavailable.') {
    super(message);
    this.name = 'EscrowWalletUnavailableError';
  }
}

/**
 * Resolve + canonicalize the NIM escrow wallet address. Throws
 * EscrowWalletUnavailableError when unset, blank, or malformed — fail
 * closed at first NIM escrow use, never at boot. Never touches key
 * material (address only; signing is P-NIM-2).
 */
export function resolveNimEscrowWalletAddress(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const raw = readWalletAddressEnv(env);
  if (raw === undefined) {
    throw new EscrowWalletUnavailableError();
  }
  try {
    return canonicalizeNimiqAddress(raw);
  } catch (err) {
    if (err instanceof InvalidAddressError) {
      throw new EscrowWalletUnavailableError();
    }
    throw err;
  }
}
