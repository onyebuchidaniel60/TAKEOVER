// Public slot detail. Handles loading, error, not-found, and
// sold-out states. Authenticated buyers can claim a live opening.
//
// Data via TanStack Query: revisits inside the stale window render the
// cached slot with zero fetches (stale-while-revalidate — the skeleton
// shows on first load only, never on a cached revisit).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ClaimButton from '../components/ClaimButton';
import ErrorState from '../components/ErrorState';
import ReportDialog from '../components/ReportDialog';
import SlotDetail from '../components/SlotDetail';
import { isAdminUser } from '../lib/admin';
import { ApiError } from '../lib/api';
import { usePageMeta } from '../lib/meta';
import { queryKeys } from '../lib/queryKeys';
import { fetchSlot, formatUsdt, fetchSlotOwnership, type PublicSlot } from '../lib/slots';
import { useAuth } from '../store/auth';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; slot: PublicSlot };

// Mirrors the server's claim gate: live status, future start, stock left.
function isClaimable(slot: PublicSlot): boolean {
  return (
    (slot.status === 'published' || slot.status === 'sold_out') &&
    new Date(slot.starts_at).getTime() > Date.now() &&
    slot.available_quantity > 0
  );
}

// Loading skeleton mirrors the final layout (hero, price card,
// details, provider) so content swaps in without layout shift.
// animate-pulse is the existing shimmer; the global reduced-motion
// blanket stops it.
function SlotDetailSkeleton() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading slot details">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-2" />
        <div className="min-w-0 flex-1">
          <div className="h-6 w-2/3 rounded bg-surface-2" />
          <div className="mt-2 h-3 w-1/3 rounded bg-surface-2" />
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="h-6 w-28 rounded-full bg-surface-2" />
        <div className="h-6 w-20 rounded-full bg-surface-2" />
      </div>
      <div className="mt-4 rounded-card border border-border bg-surface p-4">
        <div className="h-8 w-32 rounded bg-surface-2" />
      </div>
      <div className="mt-4 space-y-4 rounded-card border border-border bg-surface p-4">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="h-3 w-16 rounded bg-surface-2" />
            <div className="mt-2 h-4 w-3/4 rounded bg-surface-2" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <div className="h-8 w-8 shrink-0 rounded-full bg-surface-2" />
        <div className="h-4 w-40 rounded bg-surface-2" />
      </div>
    </div>
  );
}

export default function SlotDetailPage() {
  const { slotId } = useParams<{ slotId: string }>();
  const authenticated = useAuth((s) => s.status === 'authenticated');
  const user = useAuth((s) => s.user);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  const slotQuery = useQuery({
    queryKey: queryKeys.slot(slotId ?? ''),
    queryFn: () => fetchSlot(slotId ?? '').then((r) => r.slot),
    enabled: !!slotId,
  });
  const slot = slotQuery.data ?? null;
  const queryError = slotQuery.error;
  const notFound =
    !slotId ||
    (queryError instanceof ApiError && (queryError.status === 404 || queryError.code === 'NOT_FOUND'));
  // Same four states as before, derived from the query: skeleton only
  // while pending with no data; cached revisits render instantly.
  const state: State = notFound
    ? { kind: 'not-found' }
    : queryError
      ? {
          kind: 'error',
          message: queryError instanceof ApiError ? queryError.message : 'Something went wrong.',
        }
      : slot === null
        ? { kind: 'loading' }
        : { kind: 'ready', slot };

  // Shared-link preview: title, price, and time once the opening loads.
  const readySlot = state.kind === 'ready' ? state.slot : null;
  usePageMeta(
    readySlot
      ? {
          title: `${readySlot.title} — TAKEOVER`,
          description: `${formatUsdt(readySlot.price_usdt)} · ${new Date(readySlot.starts_at).toLocaleString()}. Claim it before it’s gone.`,
          og: {
            title: `${readySlot.title} — TAKEOVER`,
            description: `${formatUsdt(readySlot.price_usdt)} · ${new Date(readySlot.starts_at).toLocaleString()}`,
          },
        }
      : { title: 'Slot — TAKEOVER' },
  );

  // Ownership resolves only for authenticated viewers on a loaded slot.
  // Fail-open lives inside fetchSlotOwnership; the backend is the boundary.
  const readySlotId = state.kind === 'ready' ? state.slot.id : null;
  const ownershipQuery = useQuery({
    queryKey: queryKeys.slotOwnership(readySlotId ?? ''),
    queryFn: () => fetchSlotOwnership(readySlotId ?? '').then((r) => r.isOwner),
    enabled: authenticated && readySlotId !== null,
  });
  // Owner gate for the claim action (UX only — the claim transaction
  // rejects owners with CANNOT_CLAIM_OWN_SLOT regardless). Null while
  // unknown: no action is offered until ownership resolves.
  const isOwner = !authenticated || !readySlotId ? null : (ownershipQuery.data ?? null);

  const showStickyCta =
    state.kind === 'ready' && authenticated && isClaimable(state.slot) && isOwner === false;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/" className="inline-block min-h-touch py-2 text-body font-medium text-muted">
        ← Back to openings
      </Link>
      <div className="mt-2">
        {state.kind === 'loading' ? (
          <SlotDetailSkeleton />
        ) : state.kind === 'error' ? (
          <div>
            <ErrorState
              message="Couldn't load this slot. Try again."
              onRetry={() => void slotQuery.refetch()}
            />
            {/*
              Server detail stays visible (never hide errors silently):
              the user-facing copy above is fixed per spec, while a
              non-generic server reason renders as faint diagnostic
              text (React-escaped, inert). The generic fetch-failure
              text adds nothing over the spec line, so it stays hidden.
            */}
            {state.message !== 'Something went wrong.' ? (
              <p className="mt-2 text-center text-small text-faint">{state.message}</p>
            ) : null}
          </div>
        ) : state.kind === 'not-found' ? (
          <div className="rounded-card border border-border bg-surface px-4 py-12 text-center">
            <p className="text-body text-muted">This slot is no longer available.</p>
            <Link
              to="/"
              className="mt-4 inline-flex min-h-touch items-center rounded-pill border border-border-strong bg-transparent px-4 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
            >
              Back to feed
            </Link>
          </div>
        ) : (
          <>
            <SlotDetail slot={state.slot} />
            {authenticated && isClaimable(state.slot) && isOwner === true ? (
              <p className="mt-4 text-body text-muted">This is your opening.</p>
            ) : null}
            {!authenticated ? (
              <p className="mt-4 rounded-lg border border-border bg-surface p-3 text-body text-muted">
                Connect your wallet to claim this opening.
              </p>
            ) : null}
            {/* Public view: the owner projection is never served here, so every
                authenticated non-admin viewer may report. */}
            {authenticated && !isAdminUser(user) ? (
              <div className="mt-2">
                {reported ? (
                  <p role="status" className="text-body text-muted">
                    Thanks — an admin will review this opening.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setReporting(true)}
                    className="min-h-touch text-body font-medium text-muted underline"
                  >
                    Report this opening
                  </button>
                )}
              </div>
            ) : null}
            {reporting ? (
              <ReportDialog
                slotId={state.slot.id}
                onClose={() => setReporting(false)}
                onReported={() => setReported(true)}
              />
            ) : null}
            {/*
              Sticky claim CTA. Fixed above the pill nav: the nav zone
              measures 78px + safe-area above the viewport bottom (64px
              pill + 2px border + 12px margin), so bottom 90px +
              safe-area leaves exactly the 12px gap. Both offsets grow
              with the same env() term, so the gap is invariant under
              any safe-area inset. Same content column as the page
              (max-w-3xl, gutters match).
            */}
            {showStickyCta ? (
              <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+90px)] z-30 px-4 sm:px-6">
                <div className="mx-auto max-w-3xl">
                  <ClaimButton slotId={state.slot.id} />
                </div>
              </div>
            ) : null}
            {/*
              Spacer AFTER the last in-flow block: 80px covers the 56px
              button plus the 12px gap (and margin), so at max scroll
              the report row clears the fixed CTA. The shell clearance
              below still reserves the pill-nav zone itself.
            */}
            {showStickyCta ? <div aria-hidden="true" className="h-20" /> : null}
          </>
        )}
      </div>
    </main>
  );
}
