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
import {
  cancelSlot,
  fetchOwnerSlot,
  fetchSlotClaims,
  publishSlot,
  updateSlot,
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

  const handlePublish = (): void => {
    if (!slotId) return;
    setPublishing(true);
    setActionError(null);
    void publishSlot(slotId)
      .then(({ slot }) => {
        refreshAfter(slot);
        setPublishing(false);
      })
      .catch((err: unknown) => {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setPublishing(false);
      });
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
      <Link to="/sell" className="inline-block min-h-touch py-2 text-sm font-medium text-slate-600">
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
                className="inline-block min-h-touch rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
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
            onSave={handleSave}
            onPublish={handlePublish}
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
  onSave,
  onPublish,
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
  onSave: (body: SlotWrite) => void;
  onPublish: () => void;
  onAskCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
  onSlotUpdated: (slot: OwnerSlot) => void;
}) {
  const isDraft = slot.status === 'draft';
  const canCancel = slot.status === 'draft' || slot.status === 'published';
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
        <h1 className="text-2xl font-bold tracking-tight">{slot.title}</h1>
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
            <PublishButton onPublish={onPublish} publishing={publishing} />
            {!confirmingCancel ? (
              <button
                ref={cancelTriggerRef}
                type="button"
                onClick={onAskCancel}
                className="min-h-touch rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900"
              >
                Cancel opening
              </button>
            ) : null}
          </div>
          {!actionError ? null : (
            <p className="text-sm font-medium text-red-800" role="alert">
              {actionError}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Publishing makes it visible to everyone right away.
          </p>
        </>
      ) : (
        <>
          <SlotDetail slot={slot} />
          <p className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500">
            Pays to: <span className="font-mono break-all">{slot.payout_wallet}</span>
          </p>
          {slot.status === 'published' ? (
            <p className="text-xs text-slate-500">
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
            className="min-h-touch rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-900"
          >
            Cancel opening
          </button>
        </div>
      ) : null}
      {!isDraft && actionError ? (
        <p className="text-sm font-medium text-red-800" role="alert">
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
      <section aria-label="Demand" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold tracking-tight">Demand</h2>
        <p className="mt-1 text-sm text-slate-600">Couldn&apos;t load claims right now.</p>
      </section>
    );
  }
  if (claims === null) {
    return (
      <section aria-label="Demand" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold tracking-tight">Demand</h2>
        <p className="mt-1 text-sm text-slate-600">Loading claims…</p>
      </section>
    );
  }
  if (claims.length === 0) {
    return (
      <section aria-label="Demand" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-bold tracking-tight">Demand</h2>
        <p className="mt-1 text-sm text-slate-600">No claims yet.</p>
      </section>
    );
  }
  return (
    <section aria-label="Demand" className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-bold tracking-tight">Demand</h2>
      <ul className="mt-2 flex flex-col gap-3">
        {claims.map((item) => (
          <li key={item.id} className="rounded-lg bg-slate-50 p-3">
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
        <span className="text-sm font-medium text-slate-900">{claim.buyerDisplay}</span>
        <ClaimStatusBadge status={claim.status} />
      </div>
      {escrowStatus !== null && escrowStatus !== 'created' ? (
        <p className="mt-1 text-xs text-slate-500">Escrow: {escrowStatus}</p>
      ) : null}
      {claim.status === 'escrow_funded' && escrowStatus === 'funded' ? (
        <MarkDeliveredForm claimId={claim.id} onDelivered={onDelivered} />
      ) : null}
    </div>
  );
}
