// Phase 7: pay for an active hold with Nimiq Pay. The server intent is
// fetched first so the screen states the exact amount and destination BEFORE
// the wallet opens. Flow: intent → broadcast the EXACT intent
// (recipient/amount/data) → record the returned string via payment-submission.
// The browser never decides success: only a 200 submission flips the UI.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../lib/api';
import {
  debugPaymentsLog,
  redactIntentForLog,
  redactSdkArgsForLog,
} from '../lib/debug-payments';
import { getNimiqProvider, sendBasicTransactionWithData } from '../lib/nimiq';
import {
  baseUnitsToSafeNumber,
  createPaymentIntent,
  submitPayment,
  type ClaimView,
  type PaymentIntent,
  type PublicSlot,
} from '../lib/slots';
import PriceDisplay from './PriceDisplay';

type Step = 'loading' | 'idle' | 'working' | 'broadcastLost';

export default function PaymentPanel({
  claim,
  slot,
  onSubmitted,
}: {
  claim: ClaimView;
  slot: PublicSlot;
  onSubmitted: () => void;
}) {
  const [step, setStep] = useState<Step>('loading');
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showReclaim, setShowReclaim] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStep('loading');
    void createPaymentIntent(claim.id)
      .then(({ intent: fetched }) => {
        if (!cancelled) {
          setIntent(fetched);
          debugPaymentsLog('payment intent received', redactIntentForLog(fetched));
          setStep('idle');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'CLAIM_EXPIRED') {
          setError('Your hold expired. You can claim again.');
          setShowReclaim(true);
        } else {
          setError(err instanceof ApiError ? err.message : 'Something went wrong.');
        }
        setStep('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [claim.id]);

  const handlePay = (): void => {
    if (!intent) return;
    const current = intent;
    setError(null);
    setShowReclaim(false);
    setBusyLabel('Waiting for wallet approval…');
    setStep('working');
    let broadcastDone = false;
    void (async () => {
      try {
        let value: number;
        try {
          value = baseUnitsToSafeNumber(current.expectedAmountNim);
        } catch {
          throw new Error('This amount cannot be sent from the browser wallet.');
        }
        let provider;
        try {
          provider = await getNimiqProvider();
        } catch {
          throw new Error('Open this app inside Nimiq Pay to pay.');
        }
        let txString: string;
        try {
          debugPaymentsLog(
            'calling sendBasicTransactionWithData',
            redactSdkArgsForLog({
              recipient: current.expectedRecipient,
              value,
              data: current.expectedData,
            }),
          );
          txString = await sendBasicTransactionWithData(provider, {
            recipient: current.expectedRecipient,
            value,
            data: current.expectedData,
          });
          debugPaymentsLog('sendBasicTransactionWithData returned', txString);
        } catch {
          throw new Error('Payment cancelled. Nothing was sent — try again.');
        }
        broadcastDone = true;
        setBusyLabel('Recording payment…');
        try {
          debugPaymentsLog('submitting payment', { txHash: txString });
          await submitPayment(claim.id, txString);
        } catch (submitErr) {
          if (submitErr instanceof ApiError && submitErr.code === 'PAYMENT_ALREADY_SUBMITTED') {
            onSubmitted();
            return;
          }
          throw submitErr;
        }
        onSubmitted();
      } catch (err) {
        if (broadcastDone) {
          // The wallet broadcast may have landed while recording failed.
          // Never auto-retry payment here: that could pay twice.
          setStep('broadcastLost');
          return;
        }
        if (err instanceof ApiError && err.code === 'CLAIM_EXPIRED') {
          setError('Your hold expired. You can claim again.');
          setShowReclaim(true);
        } else {
          setError(err instanceof Error ? err.message : 'Something went wrong.');
        }
        setStep('idle');
      }
    })();
  };

  if (step === 'broadcastLost') {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4" role="alert">
        <p className="text-sm font-semibold text-amber-900">
          Your transaction was broadcast but not recorded. Do not retry payment. Contact support.
        </p>
        <button
          type="button"
          onClick={onSubmitted}
          className="mt-3 min-h-touch rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-medium text-amber-900"
        >
          Refresh status
        </button>
      </div>
    );
  }

  if (step === 'loading' || !intent) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4" aria-busy="true">
        <p className="text-sm text-slate-500">Preparing payment…</p>
        {error ? (
          <p className="mt-2 text-sm font-medium text-red-800" role="alert">
            {error}{' '}
            {showReclaim ? (
              <Link
                to={`/slot/${slot.id}`}
                className="inline-flex min-h-touch items-center underline"
              >
                Claim again
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>
    );
  }

  const working = step === 'working';

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Pay with NIM</p>
      <div className="mt-2">
        <PriceDisplay priceNim={intent.expectedAmountNim} large />
      </div>
      <p className="mt-1 break-all text-xs text-slate-500">To {intent.expectedRecipient}</p>
      {error ? (
        <p className="mt-3 text-sm font-medium text-red-800" role="alert">
          {error}{' '}
          {showReclaim ? (
            <Link
              to={`/slot/${slot.id}`}
              className="inline-flex min-h-touch items-center underline"
            >
              Claim again
            </Link>
          ) : null}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handlePay}
        disabled={working}
        className="mt-3 min-h-touch w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
      >
        {working ? busyLabel : 'Pay with Nimiq Pay'}
      </button>
      <p className="mt-2 text-xs text-slate-500">Pay with NIM through Nimiq Pay.</p>
    </div>
  );
}
