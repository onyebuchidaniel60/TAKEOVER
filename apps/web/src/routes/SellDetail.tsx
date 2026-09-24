// Manage one owned opening. Drafts are editable + publishable;
// drafts and published openings are cancellable. Auth-guarded.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CancelConfirmDialog from '../components/CancelConfirmDialog';
import ClaimStatusBadge from '../components/ClaimStatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import MarkDeliveredForm from '../components/MarkDeliveredForm';
import PublishButton from '../components/PublishButton';
import SlotDetail from '../components/SlotDetail';
import SlotForm, { initialValues } from '../components/SlotForm';
import StatusBadge from '../components/StatusBadge';
import { ApiError } from '../lib/api';
import { fetchEscrow } from '../lib/escrow';
import { usePageMeta } from '../lib/meta';
import { connectWallet, sendListingFee } from '../lib/nimiq';
import {
  cancelSlot,
  fetchConfig,
  fetchOwnerSlot,
  fetchSlotClaims,
  publishSlot,
  updateSlot,
  updateSlotContactNote,
  type ListingFeeConfig,
  type OwnerSlot,
  type ProviderSlotClaim,
  type SlotWrite,
} from '../lib/slots';

// Fee failure codes the backend can return after a broadcast hash is
// submitted (ARCH §15). The retryable set means "same hash, try again
// later" (confirmations accrue / outage passes); anything else means the
// hash can never publish and the provider needs a new payment.
const RETRYABLE_FEE_CODES = new Set([
  'PAYMENT_NOT_CONFIRMED',
  'PAYMENT_NOT_FOUND',
  'RPC_UNAVAILABLE',
]);

// sessionStorage key for the broadcast fee hash (per slot). The hash is
// public chain data (it lands in audit metadata), so tab-session scope
// is plenty — it only needs to survive a reload mid-publish, following
// the Bearer-token sessionStorage precedent in lib/api.
function feeHashKey(slotId: string): string {
  return `takeover.feeHash.${slotId}`;
}

function readStoredFeeHash(slotId: string): string | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage.getItem(feeHashKey(slotId));
  } catch {
    return null;
  }
}

function writeStoredFeeHash(slotId: string, hash: string | null): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (hash === null) {
      sessionStorage.removeItem(feeHashKey(slotId));
    } else {
      sessionStorage.setItem(feeHashKey(slotId), hash);
    }
  } catch {
    // Private mode / restricted WebView: the in-memory hash still
    // protects this session; only reload recovery is lost.
  }
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; slot: OwnerSlot };

export default function SellDetail() {
  usePageMeta({ title: 'Manage opening — TAKEOVER' });
  const { slotId } = useParams<{ slotId: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // NIM listing-fee state. feeConfig null = not loaded (or the
  // config read failed — then plain publish is attempted and the backend,
  // which is authoritative, enforces the fee). feeHash is the one-time
  // payment: once set, the approve path is gone for this session and
  // every attempt reuses the same hash (double-charge impossible).
  // feeFailure carries the last publish failure WITH a hash (code drives
  // the retryable/fatal banner copy). hasStoredHash marks a hash
  // restored from sessionStorage after a reload (no failure seen yet).
  const [feeConfig, setFeeConfig] = useState<ListingFeeConfig | null>(null);
  const [feeStep, setFeeStep] = useState<'paying' | 'verifying' | null>(null);
  const [feeHash, setFeeHash] = useState<string | null>(null);
  const [feeFailure, setFeeFailure] = useState<{ code: string; message: string } | null>(null);
  const [hasStoredHash, setHasStoredHash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchConfig()
      .then(({ listingFee }) => {
        if (!cancelled) setFeeConfig(listingFee);
      })
      .catch(() => {
        if (!cancelled) setFeeConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(() => {
    if (!slotId) {
      setState({ kind: 'not-found' });
      return;
    }
    setState({ kind: 'loading' });
    void fetchOwnerSlot(slotId)
      .then(({ slot }) => setState({ kind: 'ready', slot }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && (err.status === 404 || err.code === 'NOT_FOUND')) {
          setState({ kind: 'not-found' });
          return;
        }
        setState({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Something went wrong.',
        });
      });
  }, [slotId]);

  useEffect(() => {
    load();
  }, [load, retryKey]);

  const refreshAfter = (slot: OwnerSlot): void => {
    setState({ kind: 'ready', slot });
    setFormKey((k) => k + 1);
  };

  // Draft save: commercial PATCH first, then the contact-note PATCH in
  // the same user action when the note differs (the slot PATCH endpoint
  // accepts no note field — double round-trip, reported in Phase 4c).
  const handleSave = (body: SlotWrite, note: string | null): void => {
    if (!slotId) return;
    setSaving(true);
    setActionError(null);
    void updateSlot(slotId, body)
      .then(({ slot }) => {
        if (note === (slot.provider_contact_note ?? null)) {
          refreshAfter(slot);
          setSaving(false);
          return;
        }
        void updateSlotContactNote(slotId, note)
          .then(({ slot: withNote }) => {
            refreshAfter(withNote);
            setSaving(false);
          })
          .catch((err: unknown) => {
            // Slot saved, note failed: keep the form un-reset so the
            // typed note survives for retry; surface the reason.
            setState({ kind: 'ready', slot });
            setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
            setSaving(false);
          });
      })
      .catch((err: unknown) => {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setSaving(false);
      });
  };

  // Note-only save (locked form on published slots): the contact-note
  // PATCH is open for any owned status, commercial fields stay locked.
  const handleSaveNote = (note: string | null): void => {
    if (!slotId) return;
    setSaving(true);
    setActionError(null);
    void updateSlotContactNote(slotId, note)
      .then(({ slot }) => {
        refreshAfter(slot);
        setSaving(false);
      })
      .catch((err: unknown) => {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setSaving(false);
      });
  };

  const postPublish = (id: string, hash: string | undefined, broadcasted: boolean): void => {
    void publishSlot(id, hash)
      .then(({ slot }) => {
        refreshAfter(slot);
        setPublishing(false);
        setFeeStep(null);
        setFeeHash(null);
        writeStoredFeeHash(id, null);
        setFeeFailure(null);
        setHasStoredHash(false);
      })
      .catch((err: unknown) => {
        // After a broadcast, the hash is preserved and the failure
        // surfaces a persistent retry banner (same hash, manual retry
        // only — the approve path is gone while the hash exists).
        // Without a broadcast there is nothing to retry — plain error.
        // The backend code drives the banner copy: retryable
        // (under-confirmed / not-found / RPC down) vs fatal (the hash
        // can never publish).
        if (broadcasted) {
          setFeeFailure({
            code: err instanceof ApiError ? err.code : 'UNKNOWN',
            message: err instanceof ApiError ? err.message : 'Something went wrong.',
          });
          setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        } else {
          setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        }
        setPublishing(false);
        setFeeStep(null);
      });
  };

  const handlePublish = (): void => {
    if (!slotId) return;
    // A hash already exists: money is on-chain, so this is always a
    // same-hash retry — the wallet NEVER opens twice. This guard (not
    // just the hidden button below) is what makes a double-charge
    // structurally impossible.
    if (feeHash) {
      handleRetryPublish();
      return;
    }
    // No-fee path (unchanged): fee not required, or the config read failed
    // (the backend still enforces the fee when it is configured).
    if (!feeConfig || !feeConfig.required) {
      setPublishing(true);
      setActionError(null);
      postPublish(slotId, undefined, false);
      return;
    }
    if (feeConfig.misconfigured || !feeConfig.amountNim || !feeConfig.walletAddress) {
      setActionError('Listing fee is misconfigured. Publishing is unavailable — contact support.');
      return;
    }
    // Fee path: pay through Nimiq Pay first, then publish with the hash.
    const { amountNim, walletAddress } = feeConfig;
    setPublishing(true);
    setFeeStep('paying');
    setActionError(null);
    setFeeFailure(null);
    setHasStoredHash(false);
    void (async (): Promise<void> => {
      let provider;
      try {
        ({ provider } = await connectWallet());
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Something went wrong.');
        setPublishing(false);
        setFeeStep(null);
        return;
      }
      let hash: string;
      try {
        hash = await sendListingFee(provider, {
          to: walletAddress,
          nimAmount: amountNim,
          slotId,
        });
      } catch (err: unknown) {
        // Broadcast failure (user cancel, wallet error): nothing on-chain,
        // nothing to retry — surface the wallet's message.
        setActionError(err instanceof Error ? err.message : 'Something went wrong.');
        setPublishing(false);
        setFeeStep(null);
        return;
      }
      setFeeHash(hash);
      writeStoredFeeHash(slotId, hash);
      setFeeStep('verifying');
      postPublish(slotId, hash, true);
    })();
  };

  const handleRetryPublish = (): void => {
    if (!slotId || !feeHash) return;
    setPublishing(true);
    setFeeStep('verifying');
    setActionError(null);
    postPublish(slotId, feeHash, true);
  };

  // Escape hatch (fatal hash only): discard a hash that can never
  // publish (wrong address/amount/data) so the provider can pay again.
  // De-emphasized by design — the retry banner stays primary.
  const handleNewPayment = (): void => {
    if (!slotId) return;
    setFeeHash(null);
    writeStoredFeeHash(slotId, null);
    setFeeFailure(null);
    setHasStoredHash(false);
    setActionError(null);
  };

  // Reload recovery: a hash broadcast before a refresh returns as a
  // retry banner ("already on record"), never as a fresh pay button.
  useEffect(() => {
    if (!slotId) return;
    const stored = readStoredFeeHash(slotId);
    if (stored) {
      setFeeHash(stored);
      setHasStoredHash(true);
    } else {
      setFeeHash(null);
      setHasStoredHash(false);
    }
    setFeeFailure(null);
  }, [slotId]);

  const handleCancel = (): void => {
    if (!slotId) return;
    setCancelling(true);
    setActionError(null);
    void cancelSlot(slotId)
      .then(({ slot }) => {
        refreshAfter(slot);
        setCancelling(false);
        setConfirmingCancel(false);
      })
      .catch((err: unknown) => {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setCancelling(false);
      });
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/sell" className="inline-block min-h-touch py-2 text-body font-medium text-muted">
        ← Back to my openings
      </Link>
      <div className="mt-2">
        {state.kind === 'loading' ? (
          <LoadingSkeleton rows={1} />
        ) : state.kind === 'error' ? (
          <ErrorState message={state.message} onRetry={() => setRetryKey((k) => k + 1)} />
        ) : state.kind === 'not-found' ? (
          <EmptyState
            title="Opening not found"
            body="It may belong to a different account, or the link is wrong."
            action={
              <Link
                to="/sell"
                className="inline-block min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink"
              >
                Back to my openings
              </Link>
            }
          />
        ) : (
          <ManageSlot
            slot={state.slot}
            formKey={formKey}
            saving={saving}
            publishing={publishing}
            confirmingCancel={confirmingCancel}
            cancelling={cancelling}
            actionError={actionError}
            feeConfig={feeConfig}
            feeStep={feeStep}
            feeFailure={feeFailure}
            hasFeeHash={feeHash !== null}
            hasStoredHash={hasStoredHash}
            onSave={handleSave}
            onSaveNote={handleSaveNote}
            onPublish={handlePublish}
            onRetryPublish={handleRetryPublish}
            onNewPayment={handleNewPayment}
            onAskCancel={() => setConfirmingCancel(true)}
            onDismissCancel={() => setConfirmingCancel(false)}
            onConfirmCancel={handleCancel}
          />
        )}
      </div>
    </main>
  );
}

function ManageSlot({
  slot,
  formKey,
  saving,
  publishing,
  confirmingCancel,
  cancelling,
  actionError,
  feeConfig,
  feeStep,
  feeFailure,
  hasFeeHash,
  hasStoredHash,
  onSave,
  onSaveNote,
  onPublish,
  onRetryPublish,
  onNewPayment,
  onAskCancel,
  onDismissCancel,
  onConfirmCancel,
}: {
  slot: OwnerSlot;
  formKey: number;
  saving: boolean;
  publishing: boolean;
  confirmingCancel: boolean;
  cancelling: boolean;
  actionError: string | null;
  feeConfig: ListingFeeConfig | null;
  feeStep: 'paying' | 'verifying' | null;
  feeFailure: { code: string; message: string } | null;
  hasFeeHash: boolean;
  hasStoredHash: boolean;
  onSave: (body: SlotWrite, note: string | null) => void;
  onSaveNote: (note: string | null) => void;
  onPublish: () => void;
  onRetryPublish: () => void;
  onNewPayment: () => void;
  onAskCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
}) {
  const isDraft = slot.status === 'draft';
  const canCancel = slot.status === 'draft' || slot.status === 'published';
  // Fee disclosure. Rendered only when the config says a fee is
  // required (never Luna, never on the no-fee path). Misconfigured → publish
  // is disabled with a support banner instead.
  const feeRequired = feeConfig?.required === true;
  const feeMisconfigured =
    feeRequired && (feeConfig?.misconfigured === true || !feeConfig?.amountNim || !feeConfig?.walletAddress);
  const feeLabel =
    feeStep === 'paying' ? 'Paying…' : feeStep === 'verifying' ? 'Verifying…' : undefined;
  const publishLabel = feeRequired && !feeMisconfigured ? 'Approve payment & publish' : undefined;
  // The trigger unmounts while the inline confirmation is open, so the
  // dialog hook's restore is a no-op here: focus the re-mounted trigger
  // when the confirmation closes instead.
  const cancelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const wasConfirmingRef = useRef(confirmingCancel);
  useEffect(() => {
    if (wasConfirmingRef.current && !confirmingCancel) {
      cancelTriggerRef.current?.focus();
    }
    wasConfirmingRef.current = confirmingCancel;
  }, [confirmingCancel]);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 font-bold text-text">{slot.title}</h1>
        <StatusBadge status={slot.status} />
      </div>
      {isDraft ? (
        <>
          <SlotForm
            key={formKey}
            initial={initialValues(slot)}
            submitLabel="Save changes"
            submitting={saving}
            serverError={actionError}
            onSubmit={onSave}
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* The approve button exists only before any fee payment
                (or as the transient busy indicator mid-publish): once a
                hash exists outside publishing, the retry banner below
                is the sole publish path, so a second wallet payment is
                impossible. */}
            {!hasFeeHash || publishing ? (
              <PublishButton
                onPublish={onPublish}
                publishing={publishing}
                disabled={feeMisconfigured}
                label={publishLabel}
                busyLabel={feeLabel}
              />
            ) : null}
            {!confirmingCancel ? (
              <button
                ref={cancelTriggerRef}
                type="button"
                onClick={onAskCancel}
                className="min-h-touch rounded-lg border border-danger bg-surface px-4 py-2 text-body font-medium text-danger"
              >
                Cancel opening
              </button>
            ) : null}
          </div>
          {feeRequired && !feeMisconfigured && feeConfig?.amountNim ? (
            <p className="font-mono text-body tabular-nums text-muted">
              Pay {feeConfig.amountNim} NIM through Nimiq Pay to publish.
            </p>
          ) : null}
          {feeMisconfigured ? (
            <p className="text-body font-medium text-danger" role="alert">
              Listing fee is misconfigured. Publishing is unavailable — contact support.
            </p>
          ) : null}
          {hasFeeHash && !publishing && (feeFailure || hasStoredHash) ? (
            <FeeRetryBanner
              feeFailure={feeFailure}
              publishing={publishing}
              onRetryPublish={onRetryPublish}
              onNewPayment={onNewPayment}
            />
          ) : null}
          {!actionError ? null : (
            <p className="text-body font-medium text-danger" role="alert">
              {actionError}
            </p>
          )}
          <p className="text-small text-muted">
            Publishing makes it visible to everyone right away.
          </p>
        </>
      ) : (
        <>
          <SlotDetail slot={slot} />
          {slot.status === 'published' ? (
            <p className="text-small text-muted">
              Published details can’t be edited — only the buyer contact note below.
            </p>
          ) : null}
          {/* Locked form: commercial fields disabled, contact note the
              one editable field post-publish (Phase 4c correction 3). */}
          <SlotForm
            key={`note-${formKey}`}
            initial={initialValues(slot)}
            submitLabel="Save note"
            submitting={saving}
            serverError={actionError}
            onSubmit={() => {}}
            commercialLocked
            onSubmitNote={onSaveNote}
          />
        </>
      )}
      {canCancel && confirmingCancel ? (
        <CancelConfirmDialog
          onConfirm={onConfirmCancel}
          onDismiss={onDismissCancel}
          cancelling={cancelling}
        />
      ) : null}
      {!isDraft && !confirmingCancel && canCancel ? (
        <div>
          <button
            ref={cancelTriggerRef}
            type="button"
            onClick={onAskCancel}
            className="min-h-touch rounded-lg border border-danger bg-surface px-4 py-2 text-body font-medium text-danger"
          >
            Cancel opening
          </button>
        </div>
      ) : null}
      {!isDraft && actionError ? (
        <p className="text-body font-medium text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      {!isDraft ? <DemandSection slotId={slot.id} /> : null}
    </div>
  );
}

// Retry banner for a broadcast-but-unpublished fee (states C/D): the
// stored hash is reused, the wallet never opens. Copy depends on the
// backend code — retryable (confirmations accrue) vs fatal (the hash
// can never publish) vs restored-after-reload (no failure seen yet).
// The escape hatch (fatal only) discards the hash so the provider can
// pay again; it stays small and de-emphasized by design.
function FeeRetryBanner({
  feeFailure,
  publishing,
  onRetryPublish,
  onNewPayment,
}: {
  feeFailure: { code: string; message: string } | null;
  publishing: boolean;
  onRetryPublish: () => void;
  onNewPayment: () => void;
}) {
  const retryable = feeFailure === null || RETRYABLE_FEE_CODES.has(feeFailure.code);
  const title = feeFailure
    ? retryable
      ? 'Payment sent — waiting for confirmations. Retry with the same transaction.'
      : 'Payment sent but publish failed. Retry with the same transaction.'
    : 'A fee payment is already on record for this opening. Retry with the same transaction.';
  return (
    <div
      className="rounded-lg border border-warning bg-surface-2 p-3 text-body text-warning"
      role="alert"
    >
      <p className="font-medium">{title}</p>
      {feeFailure && !retryable ? (
        <p className="mt-1 text-body text-muted">{feeFailure.message}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRetryPublish}
          disabled={publishing}
          className="min-h-touch rounded-lg bg-accent px-4 py-2 text-body font-medium text-accent-ink disabled:opacity-50"
        >
          {publishing ? 'Retrying…' : 'Retry publish'}
        </button>
        {feeFailure && !retryable ? (
          <button
            type="button"
            onClick={onNewPayment}
            className="min-h-touch text-body font-medium text-muted underline"
          >
            Use a new payment instead
          </button>
        ) : null}
      </div>
    </div>
  );
}

// Provider demand list (D5 — per-claim rows on SellDetail).
// Claim rows come from the existing provider endpoint (truncated buyer
// identifiers server-side); each row resolves its own escrow state for
// the mark-delivered gate. Drafts have no demand section.
function DemandSection({ slotId }: { slotId: string }) {
  const [claims, setClaims] = useState<ProviderSlotClaim[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchSlotClaims(slotId)
      .then((result) => {
        if (cancelled) return;
        if (!result || !Array.isArray(result.claims)) {
          setFailed(true);
          return;
        }
        setClaims(result.claims);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slotId, refreshKey]);

  if (failed) {
    return (
      <section aria-label="Demand" className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-h2 font-bold text-text">Demand</h2>
        <p className="mt-1 text-body text-muted">Couldn&apos;t load claims right now.</p>
      </section>
    );
  }
  if (claims === null) {
    return (
      <section aria-label="Demand" className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-h2 font-bold text-text">Demand</h2>
        <p className="mt-1 text-body text-muted">Loading claims…</p>
      </section>
    );
  }
  if (claims.length === 0) {
    return (
      <section aria-label="Demand" className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-h2 font-bold text-text">Demand</h2>
        <p className="mt-1 text-body text-muted">No claims yet.</p>
      </section>
    );
  }
  return (
      <section aria-label="Demand" className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-h2 font-bold text-text">Demand</h2>
        <ul className="mt-2 flex flex-col gap-3">
        {claims.map((item) => (
          <li key={item.id} className="rounded-lg bg-surface-2 p-3">
            <ClaimDemandRow
              claim={item}
              onDelivered={() => setRefreshKey((k) => k + 1)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClaimDemandRow({
  claim,
  onDelivered,
}: {
  claim: ProviderSlotClaim;
  onDelivered: () => void;
}) {
  const [escrowStatus, setEscrowStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Provider-scoped read (slot ownership authorizes it server-side).
    // No escrow yet → 404, which simply means "nothing to deliver".
    void fetchEscrow(claim.id)
      .then(({ escrow }) => {
        if (!cancelled) setEscrowStatus(escrow && typeof escrow.status === 'string' ? escrow.status : null);
      })
      .catch(() => {
        if (!cancelled) setEscrowStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [claim.id]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body font-medium text-text">{claim.buyerDisplay}</span>
        <ClaimStatusBadge status={claim.status} />
      </div>
      {escrowStatus !== null && escrowStatus !== 'created' ? (
        <p className="mt-1 font-mono text-small tabular-nums text-muted">Escrow: {escrowStatus}</p>
      ) : null}
      {claim.status === 'escrow_funded' && escrowStatus === 'funded' ? (
        <MarkDeliveredForm claimId={claim.id} onDelivered={onDelivered} />
      ) : null}
    </div>
  );
}
