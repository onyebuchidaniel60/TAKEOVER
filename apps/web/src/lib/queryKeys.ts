// Query key scheme (Phase 5c). Prefix invalidation applies throughout:
// invalidating ['slots'] refetches every ['slots', params] variant;
// ['slot', id] and ['slots', …] never collide.
//
// - ['me']                    current user (App refresh seeds it)
// - ['notifications']         inbox list + unread count (badge + page share it)
// - ['slots', paramKey]       public feed pages (paramKey = URL query string)
// - ['slot', id]              public slot detail
// - ['slot-ownership', id]    owner probe (UX gate; backend enforces)
// - ['owner-slot', id]        provider slot view (superset projection)
// - ['my-slots', status]      provider list (status '' | 'all' | filter…)
// - ['my-claims']             buyer holds
// - ['claim', id]             buyer claim view
// - ['escrow', claimId]       escrow projection (panel + demand rows share it)
// - ['slot-claims', slotId]   provider demand list + counts
// - ['config']                listing-fee terms (static per session)
export const queryKeys = {
  me: ['me'] as const,
  notifications: ['notifications'] as const,
  slots: (paramKey: string) => ['slots', paramKey] as const,
  slot: (id: string) => ['slot', id] as const,
  slotOwnership: (id: string) => ['slot-ownership', id] as const,
  ownerSlot: (id: string) => ['owner-slot', id] as const,
  mySlots: (status: string) => ['my-slots', status] as const,
  myClaims: ['my-claims'] as const,
  claim: (id: string) => ['claim', id] as const,
  escrow: (claimId: string) => ['escrow', claimId] as const,
  escrowIntent: (claimId: string) => ['escrow-intent', claimId] as const,
  slotClaims: (slotId: string) => ['slot-claims', slotId] as const,
  config: ['config'] as const,
};

/** Invalidate every slot-scoped cache after a slot mutation. */
export async function invalidateSlotScopes(
  invalidate: (key: readonly unknown[]) => Promise<void>,
  slotId: string,
): Promise<void> {
  await Promise.all([
    invalidate(['slots']),
    invalidate(['slot', slotId]),
    invalidate(['owner-slot', slotId]),
    invalidate(['my-slots']),
  ]);
}
