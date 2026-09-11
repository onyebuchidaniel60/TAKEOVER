import {
  init,
  type ErrorResponse,
  type NimiqProvider,
  type SignatureResult,
} from '@nimiq/mini-app-sdk';

// Phase 3 wallet surface: connect (listAccounts), address retrieval, and message
// signing for the auth challenge. Phase 7 adds payment broadcast ONLY.

function unwrap<T>(result: T | ErrorResponse, what: string): T {
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const message = (result as ErrorResponse).error.message || `${what} failed.`;
    throw new Error(message);
  }
  return result as T;
}

let providerPromise: Promise<NimiqProvider> | null = null;

export function getNimiqProvider(): Promise<NimiqProvider> {
  if (!providerPromise) {
    providerPromise = init({ timeout: 10_000 });
    providerPromise.catch(() => {
      providerPromise = null;
    });
  }
  return providerPromise;
}

export async function connectWallet(): Promise<{
  provider: NimiqProvider;
  accounts: string[];
}> {
  let provider: NimiqProvider;
  try {
    provider = await getNimiqProvider();
  } catch {
    throw new Error('Open this app inside Nimiq Pay to connect a wallet.');
  }
  const accounts = unwrap(await provider.listAccounts(), 'Wallet connection');
  if (accounts.length === 0) {
    throw new Error('No Nimiq accounts found in the wallet.');
  }
  return { provider, accounts };
}

export async function signChallenge(
  provider: NimiqProvider,
  challenge: string,
): Promise<SignatureResult> {
  return unwrap(await provider.sign(challenge), 'Message signing');
}

export interface PaymentSend {
  /** Provider payout address (user-friendly, from the server intent). */
  recipient: string;
  /** Exact integer base units. Guarded to a safe JS number for the SDK. */
  value: number;
  /** Exact binding string 'TAKEOVER:v1:<claimId>', passed through verbatim. */
  data: string;
}

/**
 * Phase 7: broadcast the intent's exact payment via Nimiq Pay. Returns the
 * wallet's transaction hash (64 hex chars, no 0x prefix), recorded server-side
 * as tx_hash. Per the official Nimiq Provider API docs
 * (https://nimiq.dev/mini-apps/api-reference/nimiq-provider#sendbasictransactionwithdata
 * — Returns `string` — transaction hash), Case A applies: the installed
 * provider.d.ts JSDoc phrase "The serialized transaction" is stale forwarder
 * prose, the wallet returns the hash. Wallet rejections (including user
 * cancel) throw with the wallet's message. Used ONLY for this call — no other
 * SDK transaction usage.
 */
export async function sendBasicTransactionWithData(
  provider: NimiqProvider,
  payment: PaymentSend,
): Promise<string> {
  const result = await provider.sendBasicTransactionWithData({
    recipient: payment.recipient,
    value: payment.value,
    data: payment.data,
  });
  return unwrap<string>(result, 'Payment broadcast');
}
