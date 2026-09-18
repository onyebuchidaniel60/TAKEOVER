// Phase 5: manage one owned opening. Drafts are editable + publishable;
// drafts and published openings are cancellable. Auth-guarded.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CancelConfirmDialog from '../components/CancelConfirmDialog';
import ClaimStatusBadge from '../components/ClaimStatusBadge';
import ContactNoteForm from '../components/ContactNoteForm';
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
  type ListingFeeConfig,
  type OwnerSlot,
  type ProviderSlotClaim,
  type SlotWrite,
} from '../lib/slots';

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
  // Phase 14g-1: NIM listing-fee state. feeConfig null = not loaded (or the
  // config read failed — then plain publish is attempted and the backend,
  // which is authoritative, enforces the fee). feeHash preserves the
  // broadcast hash for the D6 same-hash retry (never auto-retried).
  const [feeConfig, setFeeConfig] = useState<ListingFeeConfig | null>(null);
  const [feeStep, setFeeStep] = useState<'paying' | 'verifying' | null>(null);
  const [feeHash, setFeeHash] = useState<string | null>(null);
  const [verifyFailed, setVerifyFailed] = useState(false);

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

  const handleSave = (body: SlotWrite): void => {
    if (!slotId) return;
    setSaving(true);
    setActionError(null);
    void updateSlot(slotId, body)
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
        setVerifyFailed(false);
      })
      .catch((err: unknown) => {
        // D6: after a broadcast, the hash is preserved and the failure
        // surfaces a persistent retry banner (same hash, manual retry only).
        // Without a broadcast there is nothing to retry — plain error.
        if (broadcasted) {
          setVerifyFailed(true);
        } else {
          setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        }
        if (broadcasted && err instanceof ApiError) {
          setActionError(err.message);
        }
        setPublishing(false);
        setFeeStep(null);
      });
  };

  const handlePublish = (): void => {
    if (!slotId) return;
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
    setVerifyFailed(false);
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
      <Link to="/sell" className="inline-block min-h-touch py-2 text-body font-medium text-taupe dark:text-drift">
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
                className="inline-block min-h-touch rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory dark:bg-sandlight dark:text-coal"
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
            verifyFailed={verifyFailed}
            onSave={handleSave}
            onPublish={handlePublish}
            onRetryPublish={handleRetryPublish}
            onAskCancel={() => setConfirmingCancel(true)}
            onDismissCancel={() => setConfirmingCancel(false)}
            onConfirmCancel={handleCancel}
            onSlotUpdated={refreshAfter}
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
  verifyFailed,
  onSave,
  onPublish,
  onRetryPublish,
  onAskCancel,
  onDismissCancel,
  onConfirmCancel,
  onSlotUpdated,
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
  verifyFailed: boolean;
  onSave: (body: SlotWrite) => void;
  onPublish: () => void;
  onRetryPublish: () => void;
  onAskCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
  onSlotUpdated: (slot: OwnerSlot) => void;
}) {
  const isDraft = slot.status === 'draft';
  const canCancel = slot.status === 'draft' || slot.status === 'published';
  // Phase 14g-1: fee disclosure. Rendered only when the config says a fee is
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
        <h1 className="text-h1 font-bold text-bark dark:text-parchment">{slot.title}</h1>
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
            <PublishButton
              onPublish={onPublish}
              publishing={publishing}
              disabled={feeMisconfigured}
              label={publishLabel}
              busyLabel={feeLabel}
            />
            {!confirmingCancel ? (
              <button
                ref={cancelTriggerRef}
                type="button"
                onClick={onAskCancel}
                className="min-h-touch rounded-lg border border-clay bg-cream px-4 py-2 text-body font-medium text-clay dark:border-clayd dark:bg-cocoa dark:text-clayd"
              >
                Cancel opening
              </button>
            ) : null}
          </div>
          {feeRequired && !feeMisconfigured && feeConfig?.amountNim ? (
            <p className="font-mono text-body tabular-nums text-taupe dark:text-drift">
              Pay {feeConfig.amountNim} NIM through Nimiq Pay to publish.
            </p>
          ) : null}
          {feeMisconfigured ? (
            <p className="text-body font-medium text-clay dark:text-clayd" role="alert">
              Listing fee is misconfigured. Publishing is unavailable — contact support.
            </p>
          ) : null}
          {verifyFailed ? (
            <div
              className="rounded-lg border border-ochreline bg-ochrewash p-3 text-body text-ochre dark:border-ochred dark:bg-ochrewashd dark:text-ochred"
              role="alert"
            >
              <p className="font-medium">Payment sent but publish failed. Retry with the same transaction.</p>
              <button
                type="button"
                onClick={onRetryPublish}
                disabled={publishing}
                className="mt-2 min-h-touch rounded-lg bg-terra px-4 py-2 text-body font-medium text-ivory disabled:opacity-50 dark:bg-sandlight dark:text-coal"
              >
                {publishing ? 'Retrying…' : 'Retry publish'}
              </button>
            </div>
          ) : null}
          {!actionError ? null : (
            <p className="text-body font-medium text-clay dark:text-clayd" role="alert">
              {actionError}
            </p>
          )}
          <p className="text-small text-muted dark:text-drift">
            Publishing makes it visible to everyone right away.
          </p>
        </>
      ) : (
        <>
          <SlotDetail slot={slot} />
          {slot.status === 'published' ? (
            <p className="text-small text-muted dark:text-drift">
              Published openings can’t be edited — cancel it if something needs to change.
            </p>
          ) : null}
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
            className="min-h-touch rounded-lg border border-clay bg-cream px-4 py-2 text-body font-medium text-clay dark:border-clayd dark:bg-cocoa dark:text-clayd"
          >
            Cancel opening
          </button>
        </div>
      ) : null}
      {!isDraft && actionError ? (
        <p className="text-body font-medium text-clay dark:text-clayd" role="alert">
          {actionError}
        </p>
      ) : null}
      <ContactNoteForm
        key={slot.provider_contact_note ?? ''}
        slot={slot}
        onSaved={onSlotUpdated}
      />
      {!isDraft ? <DemandSection slotId={slot.id} /> : null}
    </div>
  );
}

// Phase 14e P2: provider demand list (D5 — per-claim rows on SellDetail).
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
      <section aria-label="Demand" className="rounded-xl border border-hairline bg-cream p-4 dark:border-rootline dark:bg-cocoa">
        <h2 className="text-h2 font-bold text-bark dark:text-parchment">Demand</h2>
        <p className="mt-1 text-body text-taupe dark:text-drift">Couldn&apos;t load claims right now.</p>
      </section>
    );
  }
  if (claims === null) {
    return (
      <section aria-label="Demand" className="rounded-xl border border-hairline bg-cream p-4 dark:border-rootline dark:bg-cocoa">
        <h2 className="text-h2 font-bold text-bark dark:text-parchment">Demand</h2>
        <p className="mt-1 text-body text-taupe dark:text-drift">Loading claims…</p>
      </section>
    );
  }
  if (claims.length === 0) {
    return (
      <section aria-label="Demand" className="rounded-xl border border-hairline bg-cream p-4 dark:border-rootline dark:bg-cocoa">
        <h2 className="text-h2 font-bold text-bark dark:text-parchment">Demand</h2>
        <p className="mt-1 text-body text-taupe dark:text-drift">No claims yet.</p>
      </section>
    );
  }
  return (
      <section aria-label="Demand" className="rounded-xl border border-hairline bg-cream p-4 dark:border-rootline dark:bg-cocoa">
        <h2 className="text-h2 font-bold text-bark dark:text-parchment">Demand</h2>
        <ul className="mt-2 flex flex-col gap-3">
        {claims.map((item) => (
          <li key={item.id} className="rounded-lg bg-sand p-3 dark:bg-umber">
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
        <span className="text-body font-medium text-bark dark:text-parchment">{claim.buyerDisplay}</span>
        <ClaimStatusBadge status={claim.status} />
      </div>
      {escrowStatus !== null && escrowStatus !== 'created' ? (
        <p className="mt-1 font-mono text-small tabular-nums text-muted dark:text-drift">Escrow: {escrowStatus}</p>
      ) : null}
      {claim.status === 'escrow_funded' && escrowStatus === 'funded' ? (
        <MarkDeliveredForm claimId={claim.id} onDelivered={onDelivered} />
      ) : null}
    </div>
  );
}
