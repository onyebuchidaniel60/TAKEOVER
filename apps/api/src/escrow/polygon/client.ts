// Phase 14d-2: Polygon escrow-contract client (USDT deposit path).
// Phase 14d-3a: real server-signed release() + receipt polling for the
// confirmation policy.
// Phase 14d-3b: real server-signed refund() + buyer-side disputeCallData().
// Real implementation of EscrowContractClient from
// packages/shared/src/escrow/contract.ts, backed by viem (base library only,
// no Polygon kit). Reads RPC + contract address from env only — never
// hardcoded, never client-supplied.
//
// Trust boundary (AGENTS.md Polygon rules): events are verified against the
// configured contract address only. getLogs is filtered by that address and
// the Deposited/Disputed topic, further filtered by the indexed escrowId.
// Client-supplied escrow ids and contract addresses are never trusted for
// filtering beyond the indexed topic value.
//
// Amounts are bigint base units (USDT 6 decimals). Never float, never number.
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  parseAbiItem,
  TransactionReceiptNotFoundError,
  type Chain,
} from 'viem';
import type {
  DepositedEvent,
  DisputedEvent,
  EscrowContractClient,
} from '../../../../../packages/shared/src/escrow/contract';
import { loadEscrowSigner, EscrowSignerUnavailableError } from './signer';
import { getPolygonBroadcastRpcUrl } from '../../env';

export { EscrowSignerUnavailableError };

/** Thrown for missing config or RPC failure. The service maps it to 503 ESCROW_CONTRACT_UNAVAILABLE. */
export class EscrowContractUnavailableError extends Error {
  constructor(message = 'Escrow contract is temporarily unavailable.') {
    super(message);
    this.name = 'EscrowContractUnavailableError';
  }
}

const DEPOSITED_EVENT = parseAbiItem(
  'event Deposited(bytes32 indexed escrowId, address indexed buyer, uint256 amount)',
);

const DISPUTED_EVENT = parseAbiItem(
  'event Disputed(bytes32 indexed escrowId, address indexed buyer)',
);

const RELEASE_FUNCTION = parseAbiItem(
  'function release(bytes32 escrowId, address toProvider)',
);

const REFUND_FUNCTION = parseAbiItem('function refund(bytes32 escrowId)');

const DISPUTE_FUNCTION = parseAbiItem('function dispute(bytes32 escrowId)');

/** Minimal log shape needed for pure decoding (viem getLogs rows satisfy this). */
export interface RawEscrowLog {
  address: string;
  topics: readonly `0x${string}`[] | string[];
  data: `0x${string}` | string;
  transactionHash?: `0x${string}` | string | null;
  blockNumber?: bigint | number | string | null;
}

function isHexAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isBytes32Hex(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/** RPC endpoint from POLYGON_RPC_URL. Unset/blank → unavailable (fail closed). */
export function getPolygonRpcUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const raw = env.POLYGON_RPC_URL;
  if (typeof raw === 'string' && raw.trim() !== '') {
    return raw.trim();
  }
  throw new EscrowContractUnavailableError('Polygon RPC is not configured.');
}

/** Contract address from USDT_ESCROW_CONTRACT_ADDRESS. Unset/malformed → unavailable. */
export function getEscrowContractAddress(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const raw = env.USDT_ESCROW_CONTRACT_ADDRESS;
  if (typeof raw === 'string' && isHexAddress(raw.trim())) {
    return raw.trim();
  }
  throw new EscrowContractUnavailableError('Escrow contract address is not configured.');
}

/**
 * Phase 14e P1 (D7 variant B): USDT token address from USDT_TOKEN_ADDRESS.
 * Served to the frontend inside the escrow-intent depositInstruction so the
 * UI approves the exact token without hardcoding anything token-specific.
 * Unset/malformed → unavailable (fail closed, same as the contract
 * address — an approval cannot be built without it).
 */
export function getUsdtTokenAddress(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string {
  const raw = env.USDT_TOKEN_ADDRESS;
  if (typeof raw === 'string' && isHexAddress(raw.trim())) {
    return raw.trim();
  }
  throw new EscrowContractUnavailableError('USDT token address is not configured.');
}

function toBlockNumber(value: RawEscrowLog['blockNumber']): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }
  return 0;
}

function toTxHash(value: RawEscrowLog['transactionHash']): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return '0x';
}

/**
 * Pure Deposited-log decoder (no network). Returns null when the log is from
 * a different contract (wrong-address logs are filtered out, never decoded).
 * Throws on malformed logs (bad topics/data) — never silently ignored.
 */
export function decodeDepositedLog(
  log: RawEscrowLog,
  expectedContractAddress: string,
): DepositedEvent | null {
  if (log.address.toLowerCase() !== expectedContractAddress.toLowerCase()) {
    return null;
  }
  const decoded = decodeEventLog({
    abi: [DEPOSITED_EVENT],
    data: log.data as `0x${string}`,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
  });
  const args = decoded.args as unknown as { escrowId: string; buyer: string; amount: bigint };
  if (!isBytes32Hex(args.escrowId) || !isHexAddress(args.buyer) || typeof args.amount !== 'bigint') {
    throw new Error('Malformed Deposited log.');
  }
  return {
    escrowId: args.escrowId,
    participant: args.buyer,
    amountBaseUnits: args.amount,
    txHash: toTxHash(log.transactionHash),
    blockNumber: toBlockNumber(log.blockNumber),
  };
}

/**
 * Pure Disputed-log decoder (no network). Same address-filter + throw-on-
 * malformed contract as decodeDepositedLog. Not used this phase beyond
 * completeness (cheap, same shape).
 */
export function decodeDisputedLog(
  log: RawEscrowLog,
  expectedContractAddress: string,
): DisputedEvent | null {
  if (log.address.toLowerCase() !== expectedContractAddress.toLowerCase()) {
    return null;
  }
  const decoded = decodeEventLog({
    abi: [DISPUTED_EVENT],
    data: log.data as `0x${string}`,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
  });
  const args = decoded.args as unknown as { escrowId: string; buyer: string };
  if (!isBytes32Hex(args.escrowId) || !isHexAddress(args.buyer)) {
    throw new Error('Malformed Disputed log.');
  }
  return {
    escrowId: args.escrowId,
    participant: args.buyer,
    amountBaseUnits: null,
    txHash: toTxHash(log.transactionHash),
    blockNumber: toBlockNumber(log.blockNumber),
  };
}

export interface PolygonClientOptions {
  rpcUrl?: string;
  contractAddress?: string;
}

/**
 * Real Polygon client. Injectable via AppOptions (fake in tests, real in
 * production), mirroring the Phase 8 RPC-client pattern.
 *
 * IMPLEMENTATION DETAIL — AGENT MAY DECIDE: full-chain scan (fromBlock 0n).
 * No deployment block is configured this phase; bounding the scan by escrow
 * creation time is a later optimization. Correctness first: older deposits
 * must still be found.
 */
export function createPolygonEscrowClient(
  options: PolygonClientOptions = {},
): EscrowContractClient {
  const rpcUrl = options.rpcUrl ?? getPolygonRpcUrl();
  const contractAddress = (options.contractAddress ?? getEscrowContractAddress()) as `0x${string}`;
  if (!isHexAddress(contractAddress)) {
    throw new EscrowContractUnavailableError('Escrow contract address is not configured.');
  }

  async function getDepositEvent(escrowId: string): Promise<DepositedEvent | null> {
    if (!isBytes32Hex(escrowId)) {
      return null;
    }
    let logs;
    try {
      const client = createPublicClient({ transport: http(rpcUrl) });
      logs = await client.getLogs({
        address: contractAddress,
        event: DEPOSITED_EVENT,
        args: { escrowId: escrowId as `0x${string}` },
        fromBlock: 0n,
        toBlock: 'latest',
      });
    } catch (err) {
      if (err instanceof EscrowContractUnavailableError) {
        throw err;
      }
      throw new EscrowContractUnavailableError('Polygon RPC request failed.');
    }
    for (const log of logs) {
      const decoded = decodeDepositedLog(
        {
          address: log.address,
          topics: [...log.topics],
          data: log.data,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
        },
        contractAddress,
      );
      if (decoded !== null) {
        return decoded;
      }
    }
    return null;
  }

  async function getDisputeEvent(escrowId: string): Promise<DisputedEvent | null> {
    if (!isBytes32Hex(escrowId)) {
      return null;
    }
    let logs;
    try {
      const client = createPublicClient({ transport: http(rpcUrl) });
      logs = await client.getLogs({
        address: contractAddress,
        event: DISPUTED_EVENT,
        args: { escrowId: escrowId as `0x${string}` },
        fromBlock: 0n,
        toBlock: 'latest',
      });
    } catch (err) {
      if (err instanceof EscrowContractUnavailableError) {
        throw err;
      }
      throw new EscrowContractUnavailableError('Polygon RPC request failed.');
    }
    for (const log of logs) {
      const decoded = decodeDisputedLog(
        {
          address: log.address,
          topics: [...log.topics],
          data: log.data,
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
        },
        contractAddress,
      );
      if (decoded !== null) {
        return decoded;
      }
    }
    return null;
  }

  return {
    getDepositEvent,
    getDisputeEvent,
    async release(escrowId: string, toProvider: string): Promise<{ txHash: string }> {
      return releaseTx(rpcUrl, contractAddress, escrowId, toProvider);
    },
    async getTransactionReceipt(txHash: string): Promise<{ confirmations: number } | null> {
      return receiptTx(rpcUrl, txHash);
    },
    async refund(escrowId: string): Promise<{ txHash: string }> {
      return refundTx(rpcUrl, contractAddress, escrowId);
    },
  };
}

/**
 * Buyer-side dispute instruction (no network, no signer). The buyer signs
 * and broadcasts dispute(escrowId) from their own wallet; the backend only
 * encodes the calldata and names the configured contract. Pure function —
 * safe to call on the event-absent dispute path without any state change.
 */
export interface DisputeInstruction {
  contractAddress: string;
  onChainEscrowId: string;
  callData: string;
}

export function disputeCallData(escrowId: string, contractAddress?: string): DisputeInstruction {
  const address = contractAddress ?? getEscrowContractAddress();
  if (!isHexAddress(address)) {
    throw new EscrowContractUnavailableError('Escrow contract address is not configured.');
  }
  if (!isBytes32Hex(escrowId)) {
    throw new EscrowContractUnavailableError('Invalid dispute parameters.');
  }
  const callData = encodeFunctionData({
    abi: [DISPUTE_FUNCTION],
    functionName: 'dispute',
    args: [escrowId as `0x${string}`],
  });
  return { contractAddress: address, onChainEscrowId: escrowId, callData };
}

/**
 * Phase 14e-2d: fd-2 diagnostics for the opaque release path.
 *
 * The service maps every signer/contract failure to a generic 503, and the
 * AppError branch never reaches the server log — so a broadcast failure was
 * undebuggable in production. Each wrap site below now emits one structured
 * line carrying the underlying error anatomy (name, message, cause chain,
 * viem metaMessages) plus public context only (escrow id, signer address,
 * RPC hostname). Curated fields only: the raw error is never dumped
 * wholesale, the full RPC URL (keyed) is never included, Bearer material is
 * redacted, and the signer secret is never in scope here (it is handled
 * solely inside the signer module, which this client touches only through
 * loadEscrowSigner).
 *
 * Sink note: Fastify's request logger is unreachable from this pure client,
 * so diagnostics go to fd 2, which Railway captures in the service logs.
 * Control flow, error types, and messages below are unchanged — logging
 * only, and the logging itself never throws.
 */
function rpcHostOf(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).hostname;
  } catch {
    return 'unparseable';
  }
}

function redactBearerText(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]');
}

interface FailureCauseLevel {
  name: string;
  message: string;
}

function failureCauseLevels(err: Error, maxDepth = 5): FailureCauseLevel[] {
  const levels: FailureCauseLevel[] = [];
  let current: unknown = err;
  for (let depth = 0; depth < maxDepth; depth++) {
    if (!(current instanceof Error)) {
      break;
    }
    const shaped = current as Error & {
      cause?: unknown;
      metaMessages?: unknown;
      shortMessage?: unknown;
      details?: unknown;
    };
    let message = redactBearerText(current.message).slice(0, 600);
    if (typeof shaped.shortMessage === 'string' && shaped.shortMessage.length > 0) {
      message += ` | short: ${redactBearerText(shaped.shortMessage).slice(0, 300)}`;
    }
    if (typeof shaped.details === 'string' && shaped.details.length > 0) {
      message += ` | details: ${redactBearerText(shaped.details).slice(0, 300)}`;
    }
    if (Array.isArray(shaped.metaMessages) && shaped.metaMessages.length > 0) {
      message += ` | meta: ${redactBearerText(shaped.metaMessages.map(String).join(' / ')).slice(0, 600)}`;
    }
    levels.push({ name: current.name, message });
    current = shaped.cause;
  }
  return levels;
}

function logPolygonFailure(site: string, err: unknown, context: Record<string, string>): void {
  const fields =
    err instanceof Error
      ? {
          name: err.name,
          message: redactBearerText(err.message).slice(0, 1000),
          causes: failureCauseLevels(err),
        }
      : {
          name: typeof err,
          message: redactBearerText(String(err)).slice(0, 1000),
          causes: [],
        };
  try {
    process.stderr.write(`[escrow-polygon-error] ${JSON.stringify({ site, ...fields, ...context })}\n`);
  } catch {
    // Diagnostics must never break the payment path.
  }
}

/**
 * Broadcast the contract release(escrowId, toProvider) from the server
 * signer. Returns the tx hash immediately after broadcast — confirmation
 * polling is the service's job (getTransactionReceipt). Signer problems
 * throw EscrowSignerUnavailableError; RPC/contract problems throw
 * EscrowContractUnavailableError. Neither error embeds key material.
 *
 * IMPLEMENTATION DETAIL — AGENT MAY DECIDE: no `viem/chains` import. That
 * barrel pulls DOM-dependent sources that break the API's DOM-less tsc
 * build (verified by bisection), and a static descriptor would sign the
 * wrong chain id when the RPC points at a testnet. The descriptor below
 * carries the endpoint's live chain id instead, so EIP-155 signing always
 * matches the chain the RPC serves; fee formatters fall back to viem
 * defaults (fine for every Polygon-family chain).
 */
async function releaseTx(
  rpcUrl: string,
  contractAddress: `0x${string}`,
  escrowId: string,
  toProvider: string,
): Promise<{ txHash: string }> {
  if (!isBytes32Hex(escrowId) || !isHexAddress(toProvider)) {
    throw new EscrowContractUnavailableError('Invalid release parameters.');
  }
  let account;
  try {
    account = loadEscrowSigner();
  } catch (err) {
    if (err instanceof EscrowSignerUnavailableError) {
      throw err;
    }
    logPolygonFailure('release-signer-load', err, {
      escrowId,
      signerAddress: process.env.ESCROW_SIGNER_ADDRESS ?? 'unset',
      rpcHost: rpcHostOf(rpcUrl),
    });
    throw new EscrowSignerUnavailableError();
  }
  let chain: Chain;
  try {
    const probe = createPublicClient({ transport: http(rpcUrl) });
    const chainId = await probe.getChainId();
    chain = {
      id: chainId,
      name: `polygon-${chainId}`,
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    };
  } catch (err) {
    if (err instanceof EscrowContractUnavailableError) {
      throw err;
    }
    logPolygonFailure('release-chain-probe', err, {
      escrowId,
      signerAddress: account.address,
      rpcHost: rpcHostOf(rpcUrl),
    });
    throw new EscrowContractUnavailableError('Polygon RPC request failed.');
  }
  // Phase 14e-2e read/write split: the broadcast wallet uses the optional
  // broadcast endpoint when configured; reads stay on POLYGON_RPC_URL.
  // Unset → identical to before (same URL for both paths).
  const broadcastRpcUrl = getPolygonBroadcastRpcUrl() ?? rpcUrl;
  try {
    const wallet = createWalletClient({ account, chain, transport: http(broadcastRpcUrl) });
    const txHash = await wallet.writeContract({
      address: contractAddress,
      abi: [RELEASE_FUNCTION],
      functionName: 'release',
      args: [escrowId as `0x${string}`, toProvider as `0x${string}`],
    });
    return { txHash };
  } catch (err) {
    if (err instanceof EscrowSignerUnavailableError) {
      throw err;
    }
    logPolygonFailure('release-broadcast', err, {
      escrowId,
      signerAddress: account.address,
      rpcHost: rpcHostOf(broadcastRpcUrl),
    });
    throw new EscrowContractUnavailableError('Release transaction failed.');
  }
}

/**
 * Broadcast the contract refund(escrowId) from the server signer. Same
 * trust and error contract as releaseTx: returns the tx hash immediately
 * after broadcast, signs for the RPC's live chain id (no `viem/chains`
 * import — see releaseTx), and never embeds key material in errors.
 */
async function refundTx(
  rpcUrl: string,
  contractAddress: `0x${string}`,
  escrowId: string,
): Promise<{ txHash: string }> {
  if (!isBytes32Hex(escrowId)) {
    throw new EscrowContractUnavailableError('Invalid refund parameters.');
  }
  let account;
  try {
    account = loadEscrowSigner();
  } catch (err) {
    if (err instanceof EscrowSignerUnavailableError) {
      throw err;
    }
    throw new EscrowSignerUnavailableError();
  }
  let chain: Chain;
  try {
    const probe = createPublicClient({ transport: http(rpcUrl) });
    const chainId = await probe.getChainId();
    chain = {
      id: chainId,
      name: `polygon-${chainId}`,
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    };
  } catch (err) {
    if (err instanceof EscrowContractUnavailableError) {
      throw err;
    }
    throw new EscrowContractUnavailableError('Polygon RPC request failed.');
  }
  // Phase 14e-2e read/write split: the broadcast wallet uses the optional
  // broadcast endpoint when configured; reads stay on POLYGON_RPC_URL.
  // Unset → identical to before (same URL for both paths).
  const broadcastRpcUrl = getPolygonBroadcastRpcUrl() ?? rpcUrl;
  try {
    const wallet = createWalletClient({ account, chain, transport: http(broadcastRpcUrl) });
    const txHash = await wallet.writeContract({
      address: contractAddress,
      abi: [REFUND_FUNCTION],
      functionName: 'refund',
      args: [escrowId as `0x${string}`],
    });
    return { txHash };
  } catch (err) {
    if (err instanceof EscrowSignerUnavailableError) {
      throw err;
    }
    throw new EscrowContractUnavailableError('Refund transaction failed.');
  }
}

/**
 * Receipt poll for a broadcast release (or refund — same shape). Null while
 * the tx is unknown (still propagating) or did not succeed — both keep the
 * escrow out of its terminal state. Reverted receipts map to null (fail
 * closed: a revert moves no funds, so it must never flip the row to
 * released/refunded).
 */
async function receiptTx(
  rpcUrl: string,
  txHash: string,
): Promise<{ confirmations: number } | null> {
  const client = createPublicClient({ transport: http(rpcUrl) });
  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
  } catch (err) {
    if (err instanceof TransactionReceiptNotFoundError) {
      return null;
    }
    logPolygonFailure('receipt-fetch', err, {
      txHash,
      rpcHost: rpcHostOf(rpcUrl),
    });
    throw new EscrowContractUnavailableError('Polygon RPC request failed.');
  }
  if (receipt.status === 'reverted') {
    return null;
  }
  let head: bigint;
  try {
    head = await client.getBlockNumber();
  } catch (err) {
    logPolygonFailure('receipt-head', err, {
      txHash,
      rpcHost: rpcHostOf(rpcUrl),
    });
    throw new EscrowContractUnavailableError('Polygon RPC request failed.');
  }
  return { confirmations: Number(head - receipt.blockNumber) + 1 };
}
