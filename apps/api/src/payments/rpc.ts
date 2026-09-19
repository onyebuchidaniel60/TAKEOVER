// Nimiq JSON-RPC read client (server-side payment verification).
// Raw fetch against NIMIQ_RPC_URL — @nimiq/core stays a test-only oracle and
// is never imported by production code.
//
// Live-verified shape (2026-09-11, https://rpc.nimiqwatch.com):
//   POST { jsonrpc: '2.0', method: 'getTransactionByHash', params: [hash], id: 1 }
//   → found:    { jsonrpc, result: { data: TxObject, metadata: null }, id }
//   → not found:{ jsonrpc, error: { code: -32603, message: 'Internal error',
//                 data: 'Transaction not found: <hash>' }, id } (HTTP 200!)
// TxObject (observed): { hash, blockNumber, timestamp, confirmations, size,
//   relatedAddresses, from, fromType, to, toType, value, fee, senderData,
//   recipientData, flags, validityStartHeight, proof, networkId,
//   executionResult } — addresses are SPACED user-friendly strings, value is
//   an integer number (luna), data arrives as HEX in recipientData
//   (senderData is '' for basic→basic with-data payments).
export const DEFAULT_NIMIQ_RPC_URL = 'https://rpc.nimiqwatch.com';

/** RPC fetch timeout: 5 seconds per the locked decision. */
export const NIMIQ_RPC_TIMEOUT_MS = 5_000;

/** Confirmations required before a payment counts as verified. */
export const REQUIRED_CONFIRMATIONS = 3;

/** Resolves the RPC endpoint: explicit NIMIQ_RPC_URL wins, else the public default. */
export function getNimiqRpcUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const raw = env.NIMIQ_RPC_URL;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  return DEFAULT_NIMIQ_RPC_URL;
}

/**
 * Predicate-ready transaction record. The client normalizes the wire shape
 * here so the verification predicate compares clean values only:
 * - value is a decimal integer string (BigInt-safe, never a float);
 * - data is the hex-DECODED recipientData message (UTF-8);
 * - recipient may be null (contract-creation txs carry no `to`).
 */
export interface TxRecord {
  hash: string;
  sender: string;
  recipient: string | null;
  value: string;
  data: string;
  confirmations: number | null;
  blockNumber: number | null;
}

export interface NimiqRpcClient {
  /** Returns the normalized tx, or null when the chain has no such transaction. */
  getTransactionByHash(hash: string): Promise<TxRecord | null>;
  /** Current chain head height (confirmations fallback only). */
  getBlockNumber(): Promise<number>;
}

/** Thrown for transport/RPC failures. Never for "tx not found" (that is null). */
export class RpcUnavailableError extends Error {
  constructor(message = 'Nimiq RPC is unavailable.') {
    super(message);
    this.name = 'RpcUnavailableError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNonNegativeInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  return null;
}

/** Integer luna as a decimal string. Throws RpcUnavailableError on garbage. */
function normalizeValue(value: unknown): string {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new RpcUnavailableError('Nimiq RPC returned a malformed transaction.');
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0) {
      throw new RpcUnavailableError('Nimiq RPC returned a malformed transaction.');
    }
    return BigInt(value).toString();
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value).toString();
  }
  throw new RpcUnavailableError('Nimiq RPC returned a malformed transaction.');
}

/**
 * Hex-decode the on-chain data message. Missing data decodes to '' (a
 * well-formed tx that simply carries no message — the predicate then reports
 * a data mismatch). Undecodable hex is returned raw: it can never equal an
 * expected `TAKEOVER:v1:<uuid>` binding (which contains non-hex characters),
 * so it also surfaces as a mismatch, never a crash.
 */
function decodeData(recipientData: unknown): string {
  if (typeof recipientData !== 'string' || recipientData === '') {
    return '';
  }
  const hex = recipientData.startsWith('0x') ? recipientData.slice(2) : recipientData;
  if (hex === '') return '';
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    return recipientData;
  }
  return Buffer.from(hex, 'hex').toString('utf8');
}

/** Normalize one wire-format transaction into a TxRecord. */
export function toTxRecord(raw: unknown, queryHash: string): TxRecord {
  if (!isRecord(raw)) {
    throw new RpcUnavailableError('Nimiq RPC returned a malformed transaction.');
  }
  if (typeof raw['from'] !== 'string' || raw['from'] === '') {
    throw new RpcUnavailableError('Nimiq RPC returned a malformed transaction.');
  }
  const to = raw['to'];
  if (to !== null && to !== undefined && typeof to !== 'string') {
    throw new RpcUnavailableError('Nimiq RPC returned a malformed transaction.');
  }
  return {
    hash: typeof raw['hash'] === 'string' && raw['hash'] !== '' ? raw['hash'] : queryHash,
    sender: raw['from'],
    recipient: typeof to === 'string' ? to : null,
    value: normalizeValue(raw['value']),
    data: decodeData(raw['recipientData']),
    confirmations: toNonNegativeInt(raw['confirmations']),
    blockNumber: toNonNegativeInt(raw['blockNumber']),
  };
}

/**
 * True only for the chain's "no such transaction" error. Matched narrowly on
 * the adjacent phrase "transaction not found" (observed verbatim) so sibling
 * errors such as "Method not found" never masquerade as a pending payment.
 */
function isNotFoundError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const text = `${String(error['data'] ?? '')} ${String(error['message'] ?? '')}`;
  return /transaction not found/i.test(text);
}

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NIMIQ_RPC_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new RpcUnavailableError('Nimiq RPC request timed out.');
    }
    throw new RpcUnavailableError('Nimiq RPC request failed.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new RpcUnavailableError(`Nimiq RPC responded with HTTP ${res.status}.`);
  }
  let body: unknown;
  try {
    body = (await res.json()) as unknown;
  } catch {
    throw new RpcUnavailableError('Nimiq RPC returned an unreadable response.');
  }
  if (!isRecord(body)) {
    throw new RpcUnavailableError('Nimiq RPC returned an unreadable response.');
  }
  if ('error' in body && body['error'] !== null && body['error'] !== undefined) {
    if (isNotFoundError(body['error'])) {
      return null;
    }
    const code = isRecord(body['error']) ? String(body['error']['code'] ?? '?') : '?';
    throw new RpcUnavailableError(`Nimiq RPC error (code ${code}).`);
  }
  if (!isRecord(body['result'])) {
    throw new RpcUnavailableError('Nimiq RPC returned an unreadable response.');
  }
  return body['result']['data'];
}

/** Production client: raw fetch, no @nimiq/core, fixed endpoint only (never user input). */
export function createRpcClient(url: string): NimiqRpcClient {
  return {
    async getTransactionByHash(hash: string): Promise<TxRecord | null> {
      const data = await rpcCall(url, 'getTransactionByHash', [hash]);
      if (data === null) return null;
      return toTxRecord(data, hash);
    },
    async getBlockNumber(): Promise<number> {
      const data = await rpcCall(url, 'getBlockNumber', []);
      const height = toNonNegativeInt(data);
      if (height === null) {
        throw new RpcUnavailableError('Nimiq RPC returned a malformed block number.');
      }
      return height;
    },
  };
}
