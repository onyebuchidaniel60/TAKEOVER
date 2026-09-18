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

export interface ListingFeeSend {
  /** TAKEOVER fee wallet (canonical NQ address, from GET /config). */
  to: string;
  /** Decimal NIM string from GET /config (e.g. "400") — converted here. */
  nimAmount: string;
  /** Slot id the fee pays for (bound into the data string). */
  slotId: string;
}

/** 1 NIM = 100,000 base units (Luna). Fee-side constant (slot prices use USDT base units in lib/slots.ts). */
const LUNA_PER_NIM_FEE = 100_000;

/**
 * Phase 14g-1: broadcast the NIM listing fee via Nimiq Pay. Wraps
 * sendBasicTransactionWithData with fee-specific shaping: decimal-NIM →
 * exact Luna safe-number, data "TAKEOVER:fee:v1:<slotId>". Returns the
 * wallet's transaction hash for the publish call. Wallet rejections
 * (including user cancel) throw with the wallet's message.
 */
export async function sendListingFee(
  provider: NimiqProvider,
  fee: ListingFeeSend,
): Promise<string> {
  const trimmed = fee.nimAmount.trim();
  const match = /^(\d+)(?:\.(\d{1,5}))?$/.exec(trimmed);
  if (!match) {
    throw new Error('Invalid listing fee amount.');
  }
  const luna = BigInt(match[1] ?? '0') * BigInt(LUNA_PER_NIM_FEE) + BigInt((match[2] ?? '').padEnd(5, '0'));
  if (luna <= 0n || luna > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid listing fee amount.');
  }
  return sendBasicTransactionWithData(provider, {
    recipient: fee.to,
    value: Number(luna),
    data: `TAKEOVER:fee:v1:${fee.slotId}`,
  });
}
