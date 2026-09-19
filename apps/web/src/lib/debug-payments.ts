// Opt-in payment diagnostics for the Nimiq Pay round-trip.
// Enabled only when the build-time flag VITE_DEBUG_PAYMENTS is exactly 'true'
// (unset or anything else → disabled). When enabled, the payment flow logs:
//   - the intent received from the backend (amount + recipient shown, tx hash
//     redacted — it is null at intent time but logged defensively);
//   - the exact arguments passed to sendBasicTransactionWithData;
//   - the exact return value from the SDK (needed for troubleshooting B —
//     "SDK returns something other than a 64-hex hash"; a tx hash is a public
//     on-chain identifier, not a credential);
//   - the body of the payment-submission POST.
// NEVER logged here: session tokens, cookie values, or full wallet addresses.
// Recipients are shown in the codebase's standard truncated display form
// (first 4 + '…' + last 4) — this reconciles "show amount and recipient" with
// "never log full wallet addresses". Amount and the TAKEOVER data binding are
// verbatim (troubleshooting C compares the on-chain data byte-for-byte).
import { truncateWalletAddress } from './slots';

export const PAYMENTS_DEBUG_PREFIX = '[takeover:payments-debug]';

/** True only when VITE_DEBUG_PAYMENTS is explicitly 'true'. Defaults to false. */
export function isDebugPaymentsEnabled(): boolean {
  return import.meta.env.VITE_DEBUG_PAYMENTS === 'true';
}

/** Gated console log: a no-op unless the debug flag is enabled. */
export function debugPaymentsLog(message: string, detail?: unknown): void {
  if (!isDebugPaymentsEnabled()) {
    return;
  }
  if (detail === undefined) {
    console.info(`${PAYMENTS_DEBUG_PREFIX} ${message}`);
  } else {
    console.info(`${PAYMENTS_DEBUG_PREFIX} ${message}`, detail);
  }
}

export interface IntentDebugView {
  amount: string;
  recipient: string;
  data: string;
  txHash: string | null;
}

/** Intent as seen in the debug log: amount + data verbatim, recipient
 * truncated, tx hash redacted when present. */
export function redactIntentForLog(intent: {
  expectedAmountNim: string;
  expectedRecipient: string;
  expectedData: string;
  txHash: string | null;
}): IntentDebugView {
  return {
    amount: intent.expectedAmountNim,
    recipient: truncateWalletAddress(intent.expectedRecipient),
    data: intent.expectedData,
    txHash: intent.txHash === null ? null : '<redacted>',
  };
}

export interface SdkArgsDebugView {
  recipient: string;
  value: number;
  data: string;
}

/** SDK call arguments as seen in the debug log: value + data verbatim,
 * recipient truncated (see module note). */
export function redactSdkArgsForLog(args: {
  recipient: string;
  value: number;
  data: string;
}): SdkArgsDebugView {
  return {
    recipient: truncateWalletAddress(args.recipient),
    value: args.value,
    data: args.data,
  };
}
