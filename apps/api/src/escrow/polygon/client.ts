// Phase 14d-2: Polygon escrow-contract client (USDT deposit path).
// Phase 14d-3a: real server-signed release() + receipt polling for the
// confirmation policy. Refund stays a 14d-3b stub.
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
    // Phase 14d-3b
    async refund(): Promise<{ txHash: string }> {
      throw new Error('Not implemented: escrow refund is Phase 14d-3b.');
    },
  };
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
  try {
    const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
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
    throw new EscrowContractUnavailableError('Release transaction failed.');
  }
}

/**
 * Receipt poll for a broadcast release. Null while the tx is unknown
 * (still propagating) or did not succeed — both keep the escrow out of its
 * terminal state. Reverted receipts map to null (fail closed: a revert
 * moves no funds, so it must never flip the row to released).
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
    throw new EscrowContractUnavailableError('Polygon RPC request failed.');
  }
  if (receipt.status === 'reverted') {
    return null;
  }
  let head: bigint;
  try {
    head = await client.getBlockNumber();
  } catch {
    throw new EscrowContractUnavailableError('Polygon RPC request failed.');
  }
  return { confirmations: Number(head - receipt.blockNumber) + 1 };
}
