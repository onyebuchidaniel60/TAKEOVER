// Phase 14d-2: Polygon escrow-contract client (USDT deposit path).
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
import { createPublicClient, decodeEventLog, http, parseAbiItem } from 'viem';
import type {
  DepositedEvent,
  DisputedEvent,
  EscrowContractClient,
} from '../../../../../packages/shared/src/escrow/contract';

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
    // Phase 14d-3
    async release(): Promise<{ txHash: string }> {
      throw new Error('Not implemented: escrow release is Phase 14d-3.');
    },
    // Phase 14d-3
    async refund(): Promise<{ txHash: string }> {
      throw new Error('Not implemented: escrow refund is Phase 14d-3.');
    },
  };
}
