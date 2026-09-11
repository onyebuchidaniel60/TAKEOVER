import {
  init,
  type ErrorResponse,
  type NimiqProvider,
  type SignatureResult,
} from '@nimiq/mini-app-sdk';

// Phase 3 wallet surface: connect (listAccounts), address retrieval, and message
// signing for the auth challenge ONLY. No transactions here (later phases).

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
