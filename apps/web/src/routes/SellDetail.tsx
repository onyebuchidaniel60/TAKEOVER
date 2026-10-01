// Manage one owned opening. Drafts are editable + publishable;
// drafts and published openings are cancellable. Auth-guarded.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import CancelConfirmDialog from '../components/CancelConfirmDialog';
import ClaimStatusBadge from '../components/ClaimStatusBadge';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import LoadingSkeleton from '../components/LoadingSkeleton';
import MarkDeliveredForm from '../components/MarkDeliveredForm';
import PublishButton from '../components/PublishButton';
import FeeRetryBanner, { RETRYABLE_FEE_CODES } from '../components/FeeRetryBanner';
import { pollUntilPublished } from '../lib/fee-poll';
import SlotDetail from '../components/SlotDetail';
import SlotForm, { initialValues } from '../components/SlotForm';
import StatusBadge from '../components/StatusBadge';
import { ApiError } from '../lib/api';
import { fetchEscrow } from '../lib/escrow';
import { usePageMeta } from '../lib/meta';
import { connectWallet, sendListingFee } from '../lib/nimiq';
import { invalidateSlotScopes, queryKeys } from '../lib/queryKeys';
import {
  cancelSlot,
  fetchConfig,
  fetchOwnerSlot,
  fetchSlotClaims,
  publishSlot,
  updateSlot,
  updateSlotContactNote,
  updateSlotImage,
  type ListingFeeConfig,
  type OwnerSlot,
  type ProviderSlotClaim,
  type SlotWrite,
} from '../lib/slots';

// Fee failure codes the backend can return after a broadcast hash is
// submitted (ARCH §15). The retryable set means "same hash, try again
// later" (confirmations accrue / outage passes); anything else means the
// hash can never publish and the provider needs a new payment.

// Phase 5n-C (D24) polling model. The user sees progress, never a retry
// button: a fee payment that is on-chain but not yet at 3 confirmations is a
// WAITING state, not a failure, and the backend still owns the decision on
// every poll.
const FEE_POLL_MS = 5_000;
/** RPC outage: slow down, but keep going. The chain read is the flaky part. */
const FEE_POLL_BACKOFF_MS = 15_000;
/** After this, stop asking and tell the user it will finish on its own. */
const FEE_POLL_TOTAL_MS = 5 * 60_000;

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
  const location = useLocation();
  const navigate = useNavigate();
  // Phase 5 side item: SellNew flags a contact-note PATCH that failed
  // after the slot was created (navigate-anyway, never silent). The flag
  // rides location.state; dismiss replaces the entry to clear it. (Only
  // noteFailed travels this way — no other state to preserve.)
  const [noteBannerDismissed, setNoteBannerDismissed] = useState(false);
  const showNoteBanner =
    !noteBannerDismissed &&
    typeof location.state === 'object' &&
    location.state !== null &&
    (location.state as { noteFailed?: unknown }).noteFailed === true;
  const dismissNoteBanner = (): void => {
    setNoteBannerDismissed(true);
    navigate(location.pathname, { replace: true });
  };
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // NIM listing-fee state. feeHash is the one-time payment: once set,
  // the approve path is gone for this session and every attempt reuses
  // the same hash (double-charge impossible). It is ALSO the reload signal —
  // Phase 5n-C reads it back from sessionStorage and re-arms the poll loop,
  // so a page refresh mid-publish still needs no user action. feeFailure
  // carries the last publish failure WITH a hash (its code drives the
  // auto-retry vs hard-failure branch).
  const [feeStep, setFeeStep] = useState<'paying' | 'verifying' | null>(null);
  const [feeHash, setFeeHash] = useState<string | null>(null);
  // Phase 5n-C: live confirmation progress from the error meta, plus the
  // "still confirming" handover once the poll budget is spent.
  const [feeConfirm, setFeeConfirm] = useState<{
    confirmations: number | null;
    required: number;
  } | null>(null);
  const [feeHandover, setFeeHandover] = useState(false);
  // Auto-retry is ON while a hash is on-chain and the last outcome was
  // retryable. A fatal code clears it and the hard-failure banner returns.
  const [autoRetrying, setAutoRetrying] = useState(false);
  const pollDeadlineRef = useRef<number | null>(null);
  const [feeFailure, setFeeFailure] = useState<{ code: string; message: string } | null>(null);

  const queryClient = useQueryClient();

  // Fee terms: static per session. A failed read degrades to null (plain
  // publish attempted; the backend stays authoritative on the fee).
  const configQuery = useQuery({
    queryKey: queryKeys.config,
    queryFn: fetchConfig,
  });
  const feeConfig = configQuery.data?.listingFee ?? null;

  const ownerQuery = useQuery({
    queryKey: queryKeys.ownerSlot(slotId ?? ''),
    queryFn: () => fetchOwnerSlot(slotId ?? ''),
    enabled: !!slotId,
  });
  const ownerSlot = ownerQuery.data?.slot ?? null;
  const ownerError = ownerQuery.error;
  const state: State =
    !slotId ||
    (ownerError instanceof ApiError && (ownerError.status === 404 || ownerError.code === 'NOT_FOUND'))
      ? { kind: 'not-found' }
      : ownerError
        ? {
            kind: 'error',
            message: ownerError instanceof ApiError ? ownerError.message : 'Something went wrong.',
          }
        : ownerSlot === null
          ? { kind: 'loading' }
          : { kind: 'ready', slot: ownerSlot };

  // Stable identities: the fee poll effect below depends on these, and
  // re-creating them per render would restart the poll loop every render.
  const refreshAfter = useCallback(
    (slot: OwnerSlot): void => {
      if (slotId) queryClient.setQueryData(queryKeys.ownerSlot(slotId), { slot });
      setFormKey((k) => k + 1);
    },
    [slotId, queryClient],
  );

  const invalidateScopes = useCallback((): void => {
    if (slotId) {
      void invalidateSlotScopes(
        (key) => queryClient.invalidateQueries({ queryKey: key }),
        slotId,
      );
    }
  }, [slotId, queryClient]);

  // Slot mutations as mutateAsync transports: the Phase 4c state
  // machine around them (fee hash guard, banners, form reset rules) is
  // untouched — only the call shape changes, plus cache invalidation on
  // every success path (slot scopes cover feed, detail, owner, lists).
  const updateSlotMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: SlotWrite }) => updateSlot(id, body),
  });
  const noteMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string | null }) =>
      updateSlotContactNote(id, note),
  });
  const imageMutation = useMutation({
    mutationFn: ({ id, image }: { id: string; image: string | null }) =>
      updateSlotImage(id, image),
  });
  const publishMutation = useMutation({
    mutationFn: ({ id, hash }: { id: string; hash: string | undefined }) => publishSlot(id, hash),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelSlot(id),
  });

  // Draft save: commercial PATCH first, then the contact-note PATCH in
  // the same user action when the note differs (the slot PATCH endpoint
  // accepts no note field — double round-trip, reported in Phase 4c).
  const handleSave = (body: SlotWrite, note: string | null): void => {
    if (!slotId) return;
    setSaving(true);
    setActionError(null);
    void updateSlotMutation
      .mutateAsync({ id: slotId, body })
      .then(({ slot }) => {
        if (note === (slot.provider_contact_note ?? null)) {
          refreshAfter(slot);
          invalidateScopes();
          setSaving(false);
          return;
        }
        void noteMutation
          .mutateAsync({ id: slotId, note })
          .then(({ slot: withNote }) => {
            refreshAfter(withNote);
            invalidateScopes();
            setSaving(false);
          })
          .catch((err: unknown) => {
            // Slot saved, note failed: keep the form un-reset so the
            // typed note survives for retry; surface the reason.
            queryClient.setQueryData(queryKeys.ownerSlot(slotId), { slot });
            setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
            setSaving(false);
          });
      })
      .catch((err: unknown) => {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setSaving(false);
      });
  };

  // Note + image save (locked form on published slots): both PATCHes
  // are open for any owned status, commercial fields stay locked. Each
  // runs only when its value changed (undefined = untouched).
  const handleSaveNote = (note: string | null, image: string | null | undefined): void => {
    if (!slotId) return;
    setSaving(true);
    setActionError(null);
    const imageStep =
      image === undefined
        ? Promise.resolve(null)
        : imageMutation.mutateAsync({ id: slotId, image }).then(({ slot }) => slot);
    void imageStep
      .then((slot) => {
        if (slot) refreshAfter(slot);
        return noteMutation.mutateAsync({ id: slotId, note });
      })
      .then(({ slot }) => {
        refreshAfter(slot);
        invalidateScopes();
        setSaving(false);
      })
      .catch((err: unknown) => {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        setSaving(false);
      });
  };

  const postPublish = (id: string, hash: string | undefined, broadcasted: boolean): void => {
    void publishMutation
      .mutateAsync({ id, hash })
      .then(({ slot }) => {
        refreshAfter(slot);
        invalidateScopes();
        setPublishing(false);
        setFeeStep(null);
        setFeeHash(null);
        writeStoredFeeHash(id, null);
        setFeeFailure(null);
        setAutoRetrying(false);
        setFeeConfirm(null);
        setFeeHandover(false);
        pollDeadlineRef.current = null;
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
          const apiErr = err instanceof ApiError ? err : null;
          const code = apiErr?.code ?? 'UNKNOWN';
          setFeeFailure({ code, message: apiErr?.message ?? 'Something went wrong.' });
          // The actionable "try again" line is gone from the retryable path:
          // the poll loop owns it (D24). Fatal codes keep the message.
          setActionError(
            apiErr && RETRYABLE_FEE_CODES.has(code)
              ? null
              : (apiErr?.message ?? 'Something went wrong.'),
          );
          if (apiErr && RETRYABLE_FEE_CODES.has(code)) {
            // Start (or continue) the wait. Deadline is set on the FIRST
            // retryable outcome so a long chain does not reset the budget.
            if (pollDeadlineRef.current === null) {
              pollDeadlineRef.current = Date.now() + FEE_POLL_TOTAL_MS;
            }
            setAutoRetrying(true);
            const meta = apiErr.meta as { confirmations?: number; required?: number } | undefined;
            setFeeConfirm({
              confirmations: typeof meta?.confirmations === 'number' ? meta.confirmations : null,
              required: typeof meta?.required === 'number' ? meta.required : 3,
            });
          } else {
            setAutoRetrying(false);
            setFeeConfirm(null);
          }
        } else {
          setActionError(err instanceof ApiError ? err.message : 'Something went wrong.');
        }
        setPublishing(false);
        setFeeStep(null);
      });
  };

  /**
   * Phase 5n-C (D24): the auto-retry loop.
   *
   * Driven by STATE rather than chained promises, so it survives a reload
   * (the stored hash re-arms it) and cannot double-fire. Each attempt
   * re-POSTs the SAME hash — the fee is one payment, so this is a status
   * read dressed as a mutation, and the backend stays authoritative on
   * every single attempt.
   */
  useEffect(() => {
    if (!autoRetrying || !feeHash || !slotId) return;
let cancelled = false;
    setPublishing(true);
    setFeeStep('verifying');
    // Captured so a successful poll can render the published slot without
    // waiting for a reload — the loop IS the publish, so nothing else will
    // refresh the page's view of it.
    let publishedSlot: OwnerSlot | null = null;
    void pollUntilPublished({
      hash: feeHash,
      attempt: () =>
        publishSlot(slotId, feeHash).then(
          ({ slot }) => {
            publishedSlot = slot;
            return { ok: true, status: 200, json: () => Promise.resolve({ data: { slot } }) };
          },
          (err: unknown) => ({
            ok: false,
            status: err instanceof ApiError ? err.status : 0,
            json: () =>
              Promise.resolve({
                error: {
                  code: err instanceof ApiError ? err.code : 'UNKNOWN',
                  message: err instanceof ApiError ? err.message : 'Something went wrong.',
                  meta: err instanceof ApiError ? err.meta : undefined,
                },
              }),
          }),
        ),
      intervalMs: FEE_POLL_MS,
      backoffMs: FEE_POLL_BACKOFF_MS,
      totalMs: FEE_POLL_TOTAL_MS,
      now: () => Date.now(),
      setTimeoutFn: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeoutFn: (handle) => window.clearTimeout(handle),
}).then((outcome) => {
      if (cancelled) return;
      setAutoRetrying(false);
      if (outcome === 'published') {
        // The loop performed the publish, so this is where the page learns
        // about it: clear the hash, then show the published slot.
        if (publishedSlot) {
          refreshAfter(publishedSlot);
          invalidateScopes();
        }
        setFeeHash(null);
        writeStoredFeeHash(slotId, null);
        setFeeConfirm(null);
        setFeeHandover(false);
        setFeeFailure(null);
        pollDeadlineRef.current = null;
      } else if (outcome === 'handover') {
        // Budget spent. The hash is already on the slot row server-side, so
        // the publish still lands — the user is told, not left hanging.
        setFeeHandover(true);
        setFeeConfirm(null);
      } else {
        // Hard failure: this hash can never publish, so surface the code and
        // stop polling.
        setFeeConfirm(null);
      }
      setPublishing(false);
      setFeeStep(null);
    });
    return () => {
      cancelled = true;
    };
  }, [autoRetrying, feeHash, slotId, invalidateScopes, refreshAfter]);

  const handlePublish = (): void => {
    if (!slotId) return;
    // A hash already exists: money is on-chain, so this is always a
    // same-hash retry — the wallet NEVER opens twice. This guard (not
    // just the hidden button below) is what makes a double-charge
    // structurally impossible.
    if (feeHash) {
      // Phase 5n-C: no manual retry any more. If a hash exists the poll
      // loop is already running (or has handed over); re-arming it here is
      // just a safety net for a case where the loop was never started.
      setAutoRetrying(true);
      if (pollDeadlineRef.current === null) {
        pollDeadlineRef.current = Date.now() + FEE_POLL_TOTAL_MS;
      }
      setPublishing(true);
      setFeeStep('verifying');
      setActionError(null);
      postPublish(slotId, feeHash, true);
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


  // Escape hatch (fatal hash only): discard a hash that can never
  // publish (wrong address/amount/data) so the provider can pay again.
  // De-emphasized by design — the retry banner stays primary.
  const handleNewPayment = (): void => {
    if (!slotId) return;
    setFeeHash(null);
    writeStoredFeeHash(slotId, null);
    setFeeFailure(null);
    setActionError(null);
  };

  // Reload recovery (Phase 5n-C): a hash broadcast before a refresh comes
  // back as a hash on record, and the poll loop RE-ARMS immediately — the
  // user reloads mid-publish and still never has to press anything.
  useEffect(() => {
    if (!slotId) return;
    const stored = readStoredFeeHash(slotId);
    if (stored) {
      setFeeHash(stored);
      setAutoRetrying(true);
      if (pollDeadlineRef.current === null) {
        pollDeadlineRef.current = Date.now() + FEE_POLL_TOTAL_MS;
      }
    } else {
      setFeeHash(null);
      setAutoRetrying(false);
    }
    setFeeFailure(null);
    setFeeHandover(false);
  }, [slotId]);

  const handleCancel = (): void => {
    if (!slotId) return;
    setCancelling(true);
    setActionError(null);
    void cancelMutation
      .mutateAsync(slotId)
      .then(({ slot }) => {
        refreshAfter(slot);
        invalidateScopes();
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
          <ErrorState message={state.message} onRetry={() => void ownerQuery.refetch()} />
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
          <>
            {showNoteBanner ? (
              <div
                className="mb-4 rounded-card border border-warning bg-surface p-4"
                role="status"
              >
                <p className="text-body font-medium text-text">
                  Slot created — the contact note wasn&apos;t saved. Add it below.
                </p>
                <button
                  type="button"
                  onClick={dismissNoteBanner}
                  className="mt-2 min-h-touch text-body font-medium text-muted underline"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
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
            feeConfirm={feeConfirm}
            feeHandover={feeHandover}
            onSave={handleSave}
            onSaveNote={handleSaveNote}
            onPublish={handlePublish}
            onNewPayment={handleNewPayment}
            onAskCancel={() => setConfirmingCancel(true)}
            onDismissCancel={() => setConfirmingCancel(false)}
            onConfirmCancel={handleCancel}
          />
          </>
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
  feeConfirm,
  feeHandover,
  onSave,
  onSaveNote,
  onPublish,
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
  /** Phase 5n-C: a retryable fee failure is being polled automatically. */
  feeConfirm: { confirmations: number | null; required: number } | null;
  feeHandover: boolean;
  onSave: (body: SlotWrite, note: string | null) => void;
  onSaveNote: (note: string | null, image: string | null | undefined) => void;
  onPublish: () => void;
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
          {/* Save is the secondary utility here (Phase 5e): the draft
              exists, so publishing is the goal and owns the primary CTA
              below. */}
          <SlotForm
            key={formKey}
            initial={initialValues(slot)}
            submitLabel="Save changes"
            submitting={saving}
            serverError={actionError}
            onSubmit={onSave}
            submitVariant="secondary"
          />
          {/* Publish-first action stack (Phase 5e): the approve button is
              centered and largest; cancel sits below as the smaller
              danger-outline utility. Conditions untouched (Phase 4c
              state machine) — only the visual shell moved. */}
          <div className="flex flex-col items-center gap-3">
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
          {/* Phase 5n-C: the banner is also the live progress surface, so it
              must stay mounted WHILE polling (previously it only rendered
              when idle). `hasFeeHash` alone is the right condition. */}
          {hasFeeHash ? (
            <FeeRetryBanner
              feeFailure={feeFailure}
              publishing={publishing}
              confirm={feeConfirm}
              handover={feeHandover}
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
// Provider demand list (D5 — per-claim rows on SellDetail).
// Claim rows come from the existing provider endpoint (truncated buyer
// identifiers server-side); each row resolves its own escrow state for
// the mark-delivered gate. Drafts have no demand section.
function DemandSection({ slotId }: { slotId: string }) {
  const queryClient = useQueryClient();
  const claimsQuery = useQuery({
    queryKey: queryKeys.slotClaims(slotId),
    queryFn: () => fetchSlotClaims(slotId),
  });
  const result = claimsQuery.data ?? null;
  const claims: ProviderSlotClaim[] | null = result?.claims ?? null;
  // Defensive preserved: a malformed payload renders the failed state,
  // never crashes the demand section.
  const failed =
    claimsQuery.isError || (result !== null && !Array.isArray(result.claims));

  if (failed) {
    return (
      <section aria-label="Demand" className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-h2 font-bold text-text">Demand</h2>
        <p className="mt-1 text-body text-muted">Couldn&apos;t load claims right now.</p>
      </section>
    );
  }
  if (claimsQuery.isPending || claims === null) {
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
              onDelivered={() => {
                void queryClient.invalidateQueries({ queryKey: queryKeys.slotClaims(slotId) });
              }}
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
  // Provider-scoped read (slot ownership authorizes it server-side).
  // No escrow yet → 404, which simply means "nothing to deliver".
  // Shares the ['escrow', claimId] cache with the buyer claim page.
  const escrowQuery = useQuery({
    queryKey: queryKeys.escrow(claim.id),
    queryFn: () =>
      fetchEscrow(claim.id)
        .then(({ escrow }) => escrow)
        .catch(() => null),
  });
  const escrow = escrowQuery.data ?? null;
  const escrowStatus =
    escrow && typeof escrow.status === 'string' ? escrow.status : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-body font-medium text-text">
          <Avatar data={claim.buyerAvatar ?? null} name={claim.buyerDisplay} size={24} />
          {claim.buyerDisplay}
        </span>
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
