// Window.ethereum wrapper + hand-encoded calldata (D1).
//
// No viem/ethers on the frontend (owner decision D1). The three fixed call
// shapes (ERC-20 approve, escrow deposit, escrow dispute) are encoded by
// hand: 4-byte selector + 32-byte ABI words (address = left-padded,
// uint256 = big-endian, bytes32 = as-is). Selectors are keccak256(sig)[0:4],
// computed once with the backend's viem and pinned by vectors in
// test/evm-lib.test.ts:
//   approve(address,uint256) = 0x095ea7b3 (canonical ERC-20)
//   deposit(bytes32,uint256) = 0x1de26e16
//   dispute(bytes32)         = 0xadd98c70
// Amounts stay BigInt base-unit strings end to end (USDT 6 decimals).
// Nothing here is token-specific except the address passed in — the token
// address always comes from the server depositInstruction (D7 variant B).

/** Polygon mainnet chain id (decimal + hex). The escrow contract lives here. */
export const POLYGON_CHAIN_ID = 137;
export const POLYGON_CHAIN_ID_HEX = '0x89';

/**
 * Explicit gas limits (hex strings) for every eth_sendTransaction call.
 * Pinned, never estimated: Nimiq Pay's window.ethereum does not reliably
 * serve eth_estimateGas, and the wallet refuses to broadcast without a gas
 * limit ("transaction must include gas or gas limit, and estimation
 * failed"). Values carry ~2x headroom over observed usage (approve ~46-50k,
 * deposit ~150-200k, dispute ~50k); dispute reuses the approve budget.
 * Never raise approve past ~500k (wasted gas refund territory).
 */
export const APPROVE_GAS_LIMIT = '0x186a0'; // 100,000
export const DEPOSIT_GAS_LIMIT = '0x30d40'; // 200,000
export const DISPUTE_GAS_LIMIT = '0x186a0'; // 100,000

/** Minimal EIP-1193 surface used by this module (structural, no globals). */
export interface EthereumProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export class NoEthereumProviderError extends Error {
  constructor(message = 'No EVM wallet detected. Open this page in a browser with an Ethereum wallet.') {
    super(message);
    this.name = 'NoEthereumProviderError';
  }
}

export class UserRejectedError extends Error {
  constructor(message = 'Transaction rejected in the wallet.') {
    super(message);
    this.name = 'UserRejectedError';
  }
}

export class EvmRpcError extends Error {
  constructor(message = 'Wallet request failed. Please try again.') {
    super(message);
    this.name = 'EvmRpcError';
  }
}

export class ReceiptTimeoutError extends Error {
  constructor(message = 'Transaction is still pending. Check again shortly.') {
    super(message);
    this.name = 'ReceiptTimeoutError';
  }
}

function ethereum(): EthereumProvider {
  const scope =
    typeof window === 'undefined'
      ? undefined
      : (window as unknown as { ethereum?: EthereumProvider });
  const injected = scope?.ethereum;
  if (!injected || typeof injected.request !== 'function') {
    throw new NoEthereumProviderError();
  }
  return injected;
}

/** window.ethereum or a user-facing "no wallet" error. Exported for tests. */
export function getEthereumProvider(): EthereumProvider {
  return ethereum();
}

function isUserRejection(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 4001
  );
}

function wrapWalletError(err: unknown): Error {
  if (err instanceof NoEthereumProviderError || err instanceof UserRejectedError) {
    throw err;
  }
  if (isUserRejection(err)) {
    throw new UserRejectedError();
  }
  const message = err instanceof Error && err.message ? err.message : 'Wallet request failed. Please try again.';
  throw new EvmRpcError(message);
}

/** 0x-prefixed 20-byte address, lowercased. Throws on anything else. */
export function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (!/^0[xX][0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error('Invalid Ethereum address.');
  }
  return trimmed.toLowerCase();
}

/** 0x-prefixed 32-byte hex, lowercased. Throws on anything else. */
export function normalizeBytes32(value: string): string {
  const trimmed = value.trim();
  if (!/^0[xX][0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error('Invalid bytes32 value.');
  }
  return trimmed.toLowerCase();
}

/** Positive uint256 as BigInt. Throws on garbage, zero, or overflow. */
export function normalizeUint256(value: string | bigint): bigint {
  let amount: bigint;
  try {
    amount = typeof value === 'bigint' ? value : BigInt(String(value).trim());
  } catch {
    throw new Error('Invalid amount.');
  }
  if (amount <= 0n || amount >= 1n << 256n) {
    throw new Error('Invalid amount.');
  }
  return amount;
}

function padAddress(address: string): string {
  return `000000000000000000000000${normalizeAddress(address).slice(2)}`;
}

function padUint256(amount: string | bigint): string {
  return normalizeUint256(amount).toString(16).padStart(64, '0');
}

/** ERC-20 approve(spender, amount) calldata. */
export function encodeApproveCall(spender: string, amount: string | bigint): string {
  return `0x095ea7b3${padAddress(spender)}${padUint256(amount)}`;
}

/** Escrow deposit(escrowId, amount) calldata. */
export function encodeDepositCall(escrowId: string, amount: string | bigint): string {
  return `0x1de26e16${normalizeBytes32(escrowId).slice(2)}${padUint256(amount)}`;
}

/** Escrow dispute(escrowId) calldata (server also serves this verbatim — kept for tests). */
export function encodeDisputeCall(escrowId: string): string {
  return `0xadd98c70${normalizeBytes32(escrowId).slice(2)}`;
}

async function request<T>(provider: EthereumProvider, method: string, params?: unknown): Promise<T> {
  try {
    return (await provider.request({ method, params })) as T;
  } catch (err) {
    throw wrapWalletError(err);
  }
}

/**
 * Assert the wallet sits on Polygon mainnet, switching (or adding) the chain
 * when needed. Rejects loudly on user cancellation vs RPC failure.
 */
export async function ensureChain(
  provider: EthereumProvider = getEthereumProvider(),
  chainIdHex: string = POLYGON_CHAIN_ID_HEX,
): Promise<void> {
  const current = await request<string>(provider, 'eth_chainId');
  if (typeof current === 'string' && current.toLowerCase() === chainIdHex.toLowerCase()) {
    return;
  }
  // Raw request (not the wrapping helper): the 4902 code below must be
  // inspected before any error mapping runs.
  let switchError: unknown = null;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
  } catch (err) {
    switchError = err;
  }
  if (switchError === null) {
    return;
  }
  if (switchError instanceof UserRejectedError || isUserRejection(switchError)) {
    throw new UserRejectedError();
  }
  const code =
    typeof switchError === 'object' && switchError !== null
      ? (switchError as { code?: unknown }).code
      : undefined;
  if (code !== 4902) {
    throw wrapWalletError(switchError);
  }
  await request(provider, 'wallet_addEthereumChain', [
    {
      chainId: chainIdHex,
      chainName: 'Polygon',
      nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
      rpcUrls: ['https://polygon-bor-rpc.publicnode.com/'],
      blockExplorerUrls: ['https://polygonscan.com/'],
    },
  ]);
}

/** Connected accounts (eth_requestAccounts). Throws when none. */
export async function getAccounts(provider: EthereumProvider = getEthereumProvider()): Promise<string[]> {
  const accounts = await request<unknown>(provider, 'eth_requestAccounts');
  if (!Array.isArray(accounts) || accounts.length === 0 || typeof accounts[0] !== 'string') {
    throw new EvmRpcError('No accounts found in the wallet.');
  }
  return accounts as string[];
}

function normalizeTxHash(value: unknown): string {
  if (typeof value !== 'string' || !/^0[xX][0-9a-fA-F]{64}$/.test(value)) {
    throw new EvmRpcError('Wallet returned an invalid transaction hash.');
  }
  return value.toLowerCase();
}

/** 0x-prefixed hex gas limit. Throws on anything else. */
export function normalizeGasLimit(value: string): string {
  const trimmed = value.trim();
  if (!/^0[xX][0-9a-fA-F]+$/.test(trimmed)) {
    throw new Error('Invalid gas limit.');
  }
  return trimmed.toLowerCase();
}

/** Raw send: { from, to, data, gas }. Gas is required — never estimate. */
export async function sendTransaction(
  provider: EthereumProvider,
  tx: { from: string; to: string; data: string; gas: string },
): Promise<string> {
  const hash = await request<unknown>(provider, 'eth_sendTransaction', [
    {
      from: normalizeAddress(tx.from),
      to: normalizeAddress(tx.to),
      data: tx.data,
      gas: normalizeGasLimit(tx.gas),
    },
  ]);
  return normalizeTxHash(hash);
}

/** ERC-20 approve(token, spender, amount) from the connected account. */
export async function approve(
  provider: EthereumProvider,
  args: { token: string; spender: string; amount: string | bigint; from: string },
): Promise<string> {
  return sendTransaction(provider, {
    from: args.from,
    to: args.token,
    data: encodeApproveCall(args.spender, args.amount),
    gas: APPROVE_GAS_LIMIT,
  });
}

/** Escrow deposit(contract, escrowId, amount) from the connected account. */
export async function deposit(
  provider: EthereumProvider,
  args: { contract: string; escrowId: string; amount: string | bigint; from: string },
): Promise<string> {
  return sendTransaction(provider, {
    from: args.from,
    to: args.contract,
    data: encodeDepositCall(args.escrowId, args.amount),
    gas: DEPOSIT_GAS_LIMIT,
  });
}

export interface WaitForReceiptOptions {
  /** Poll interval in ms. */
  intervalMs?: number;
  /** Give up after this many ms. */
  timeoutMs?: number;
}

/**
 * Poll eth_getTransactionReceipt until the tx mines. Resolves on status 1,
 * throws on status 0 (reverted) or after timeoutMs (distinct error — the tx
 * may still land later; the caller must re-poll, never re-send blindly).
 */
export async function waitForReceipt(
  provider: EthereumProvider,
  txHash: string,
  options: WaitForReceiptOptions = {},
): Promise<{ status: string; blockNumber: string }> {
  const intervalMs = options.intervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const started = Date.now();
  const hash = normalizeTxHash(txHash);
  for (;;) {
    const receipt = await request<null | { status?: unknown; blockNumber?: unknown }>(
      provider,
      'eth_getTransactionReceipt',
      [hash],
    );
    if (receipt !== null && typeof receipt === 'object') {
      const status = typeof receipt.status === 'string' ? receipt.status.toLowerCase() : '';
      if (status === '0x1') {
        return {
          status,
          blockNumber: typeof receipt.blockNumber === 'string' ? receipt.blockNumber : '0x0',
        };
      }
      if (status === '0x0') {
        throw new EvmRpcError('Transaction reverted on-chain.');
      }
    }
    if (Date.now() - started > timeoutMs) {
      throw new ReceiptTimeoutError();
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
