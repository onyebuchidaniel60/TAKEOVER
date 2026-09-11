// Phase 10: admin moderation service. Every state change runs in ONE DB
// transaction that also writes its audit event — audit and action succeed or
// fail together. Admin endpoints carry no additional per-IP rate limit (they
// sit behind admin auth); the only rate-limited Phase 10 surface is
// POST /reports (5/hour per user).
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { auditEvents, claims, paymentIntents, reports, sessions, slots, users } from '../../../../db/schema';
import { truncateWalletAddress } from '../auth/nimiq-address';
import { writeAuditEvent } from '../audit/events';
import { AppError } from '../http/errors';
import { serializePriceNim } from '../slots/price';

type Db = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface AdminReportView {
  id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  resolution_notes: string | null;
  resolved_by_user_id: string | null;
  reporter: { id: string; walletDisplay: string };
  slot: { id: string; title: string; status: string } | null;
  targetUser: { id: string; walletDisplay: string } | null;
}

export async function listReports(
  db: Db,
  options: { status?: 'open' | 'reviewed' | 'dismissed'; limit: number; offset: number },
): Promise<{ reports: AdminReportView[]; total: number }> {
  const where =
    options.status === undefined ? undefined : eq(reports.status, options.status);
  const rows = await db
    .select({ report: reports })
    .from(reports)
    .where(where)
    .orderBy(desc(reports.createdAt))
    .limit(options.limit)
    .offset(options.offset);
  const totalRows = await db.select({ value: count() }).from(reports).where(where);
  const views: AdminReportView[] = [];
  for (const { report } of rows) {
    const reporterRows = await db
      .select({ id: users.id, walletAddress: users.walletAddress })
      .from(users)
      .where(eq(users.id, report.reporterId))
      .limit(1);
    const reporter = reporterRows[0];
    if (!reporter) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    let slot: AdminReportView['slot'] = null;
    if (report.slotId !== null) {
      const slotRows = await db
        .select({ id: slots.id, title: slots.title, status: slots.status })
        .from(slots)
        .where(eq(slots.id, report.slotId))
        .limit(1);
      if (slotRows[0]) {
        slot = { id: slotRows[0].id, title: slotRows[0].title, status: slotRows[0].status };
      }
    }
    let targetUser: AdminReportView['targetUser'] = null;
    if (report.targetUserId !== null) {
      const targetRows = await db
        .select({ id: users.id, walletAddress: users.walletAddress })
        .from(users)
        .where(eq(users.id, report.targetUserId))
        .limit(1);
      if (targetRows[0]) {
        targetUser = {
          id: targetRows[0].id,
          walletDisplay: truncateWalletAddress(targetRows[0].walletAddress),
        };
      }
    }
    views.push({
      id: report.id,
      reason: report.reason,
      details: report.details,
      status: report.status,
      created_at: report.createdAt.toISOString(),
      reviewed_at: report.reviewedAt ? report.reviewedAt.toISOString() : null,
      resolution_notes: report.resolutionNotes,
      resolved_by_user_id: report.resolvedByUserId,
      reporter: { id: reporter.id, walletDisplay: truncateWalletAddress(reporter.walletAddress) },
      slot,
      targetUser,
    });
  }
  return { reports: views, total: totalRows[0]?.value ?? 0 };
}

export async function resolveReport(
  db: Db,
  options: {
    reportId: string;
    adminId: string;
    action: 'reviewed' | 'dismissed';
    resolutionNotes: string;
    requestId?: string | null;
  },
): Promise<AdminReportView> {
  const updated = await db.transaction(async (tx) => {
    const existing = await tx.select().from(reports).where(eq(reports.id, options.reportId)).limit(1);
    const current = existing[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'Report not found.');
    }
    const now = new Date();
    const rows = await tx
      .update(reports)
      .set({
        status: options.action,
        resolutionNotes: options.resolutionNotes,
        resolvedByUserId: options.adminId,
        reviewedAt: now,
      })
      .where(eq(reports.id, options.reportId))
      .returning();
    const row = rows[0];
    if (!row) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    // Resolution takes no automatic further action (locked decision).
    await writeAuditEvent(tx, {
      actorUserId: options.adminId,
      eventType: 'report.resolved',
      entityType: 'report',
      entityId: row.id,
      requestId: options.requestId ?? null,
      metadata: { from: current.status, to: options.action, resolutionNotes: options.resolutionNotes },
    });
    return row;
  });
  const listed = await listReports(db, { limit: 1, offset: 0 });
  void listed;
  // Reuse the list projector for a single consistent shape.
  const db2 = db;
  const rows = await db2.select({ report: reports }).from(reports).where(eq(reports.id, updated.id)).limit(1);
  const report = rows[0]?.report;
  if (!report) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  const reporterRows = await db
    .select({ id: users.id, walletAddress: users.walletAddress })
    .from(users)
    .where(eq(users.id, report.reporterId))
    .limit(1);
  const reporter = reporterRows[0];
  if (!reporter) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  let slot: AdminReportView['slot'] = null;
  if (report.slotId !== null) {
    const slotRows = await db
      .select({ id: slots.id, title: slots.title, status: slots.status })
      .from(slots)
      .where(eq(slots.id, report.slotId))
      .limit(1);
    if (slotRows[0]) {
      slot = { id: slotRows[0].id, title: slotRows[0].title, status: slotRows[0].status };
    }
  }
  let targetUser: AdminReportView['targetUser'] = null;
  if (report.targetUserId !== null) {
    const targetRows = await db
      .select({ id: users.id, walletAddress: users.walletAddress })
      .from(users)
      .where(eq(users.id, report.targetUserId))
      .limit(1);
    if (targetRows[0]) {
      targetUser = {
        id: targetRows[0].id,
        walletDisplay: truncateWalletAddress(targetRows[0].walletAddress),
      };
    }
  }
  return {
    id: report.id,
    reason: report.reason,
    details: report.details,
    status: report.status,
    created_at: report.createdAt.toISOString(),
    reviewed_at: report.reviewedAt ? report.reviewedAt.toISOString() : null,
    resolution_notes: report.resolutionNotes,
    resolved_by_user_id: report.resolvedByUserId,
    reporter: { id: reporter.id, walletDisplay: truncateWalletAddress(reporter.walletAddress) },
    slot,
    targetUser,
  };
}

// ---------------------------------------------------------------------------
// Slot disable
// ---------------------------------------------------------------------------

export interface DisableSlotResult {
  slot: { id: string; status: string; available_quantity: number; cancelled_at: string | null };
  /** Claim ids moved from payment_pending to payment_review. */
  migratedClaims: string[];
  /** Claim ids moved from active_hold to cancelled. */
  cancelledClaims: string[];
  /** Warning when migrated claims need admin resolution, else null. */
  warning: string | null;
}

export async function disableSlot(
  db: Db,
  options: { slotId: string; adminId: string; reason: string; requestId?: string | null },
): Promise<DisableSlotResult> {
  return db.transaction(async (tx) => {
    const locked = await tx.select().from(slots).where(eq(slots.id, options.slotId)).for('update');
    const slot = locked[0];
    if (!slot) {
      throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
    }
    if (slot.status !== 'draft' && slot.status !== 'published') {
      throw new AppError(409, 'SLOT_NOT_DISABLEABLE', 'This slot can no longer be disabled.');
    }
    const priorStatus = slot.status;
    const now = new Date();
    const cancelled = await tx
      .update(claims)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(claims.slotId, slot.id), eq(claims.status, 'active_hold')))
      .returning({ id: claims.id });
    const migrated = await tx
      .update(claims)
      .set({ status: 'payment_review', updatedAt: now })
      .where(and(eq(claims.slotId, slot.id), eq(claims.status, 'payment_pending')))
      .returning({ id: claims.id });
    // Paid claims are NOT touched (locked decision). payment_review, expired,
    // and cancelled rows are also left as-is. Payment intents are left as-is
    // per the locked effects list (no intent transition specified).
    const updated = await tx
      .update(slots)
      .set({ status: 'cancelled', cancelledAt: now, availableQuantity: 0, updatedAt: now })
      .where(eq(slots.id, slot.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    const migratedClaims = migrated.map((c) => c.id);
    const cancelledClaims = cancelled.map((c) => c.id);
    await writeAuditEvent(tx, {
      actorUserId: options.adminId,
      eventType: 'slot.disabled_by_admin',
      entityType: 'slot',
      entityId: row.id,
      requestId: options.requestId ?? null,
      metadata: {
        from: priorStatus,
        to: 'cancelled',
        reason: options.reason,
        migratedClaims,
        cancelledClaims,
      },
    });
    const warning =
      migratedClaims.length > 0
        ? `${migratedClaims.length} payment(s) moved to review and need admin resolution.`
        : null;
    return {
      slot: {
        id: row.id,
        status: row.status,
        available_quantity: row.availableQuantity,
        cancelled_at: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      },
      migratedClaims,
      cancelledClaims,
      warning,
    };
  });
}

// ---------------------------------------------------------------------------
// User disable
// ---------------------------------------------------------------------------

export async function disableUser(
  db: Db,
  options: { userId: string; adminId: string; reason: string; requestId?: string | null },
): Promise<{ user: { id: string; status: string; disabled_at: string | null } }> {
  if (options.userId === options.adminId) {
    throw new AppError(409, 'CANNOT_DISABLE_SELF', 'You cannot disable your own account.');
  }
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(users).where(eq(users.id, options.userId)).limit(1);
    const current = existing[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'User not found.');
    }
    if (current.status === 'disabled') {
      return {
        user: {
          id: current.id,
          status: current.status,
          disabled_at: current.disabledAt ? current.disabledAt.toISOString() : null,
        },
      };
    }
    const now = new Date();
    const updated = await tx
      .update(users)
      .set({ status: 'disabled', disabledAt: now, updatedAt: now })
      .where(eq(users.id, current.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    // Revoke every active session (belt-and-suspenders with the requireAuth
    // ACCOUNT_DISABLED check, which covers any session row that survives).
    await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, current.id), sql`${sessions.revokedAt} IS NULL`));
    // Slots and claims are deliberately NOT touched (locked decision).
    await writeAuditEvent(tx, {
      actorUserId: options.adminId,
      eventType: 'user.disabled',
      entityType: 'user',
      entityId: row.id,
      requestId: options.requestId ?? null,
      metadata: { from: 'active', to: 'disabled', reason: options.reason },
    });
    return {
      user: {
        id: row.id,
        status: row.status,
        disabled_at: row.disabledAt ? row.disabledAt.toISOString() : null,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Payment reviews
// ---------------------------------------------------------------------------

export interface PaymentReviewView {
  claim: {
    id: string;
    status: string;
    buyerWallet: string;
    claimed_at: string;
    updated_at: string;
  };
  slot: { id: string; title: string; price_nim: string; payout_wallet: string };
  intent: {
    id: string;
    expected_amount_nim: string;
    expected_recipient: string;
    expected_sender: string;
    expected_data: string;
    tx_hash: string | null;
    submitted_at: string | null;
  } | null;
}

export async function listPaymentReviews(
  db: Db,
  options: { limit: number; offset: number },
): Promise<{ reviews: PaymentReviewView[]; total: number }> {
  const where = eq(claims.status, 'payment_review');
  const rows = await db
    .select({ claim: claims })
    .from(claims)
    .where(where)
    .orderBy(desc(claims.updatedAt))
    .limit(options.limit)
    .offset(options.offset);
  const totalRows = await db.select({ value: count() }).from(claims).where(where);
  const reviews: PaymentReviewView[] = [];
  for (const { claim } of rows) {
    const buyerRows = await db
      .select({ walletAddress: users.walletAddress })
      .from(users)
      .where(eq(users.id, claim.buyerId))
      .limit(1);
    const buyerWallet = buyerRows[0]?.walletAddress;
    if (!buyerWallet) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    const slotRows = await db.select().from(slots).where(eq(slots.id, claim.slotId)).limit(1);
    const slot = slotRows[0];
    if (!slot) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    const intentRows = await db
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.claimId, claim.id))
      .limit(1);
    const intent = intentRows[0] ?? null;
    reviews.push({
      claim: {
        id: claim.id,
        status: claim.status,
        buyerWallet,
        claimed_at: claim.claimedAt.toISOString(),
        updated_at: claim.updatedAt.toISOString(),
      },
      slot: {
        id: slot.id,
        title: slot.title,
        price_nim: serializePriceNim(slot.priceNim),
        payout_wallet: slot.payoutWallet,
      },
      intent: intent
        ? {
            id: intent.id,
            expected_amount_nim: serializePriceNim(intent.expectedAmountNim),
            expected_recipient: intent.expectedRecipient,
            expected_sender: intent.expectedSender,
            expected_data: intent.expectedData,
            tx_hash: intent.txHash,
            submitted_at: intent.submittedAt ? intent.submittedAt.toISOString() : null,
          }
        : null,
    });
  }
  return { reviews, total: totalRows[0]?.value ?? 0 };
}

export async function resolvePaymentReview(
  db: Db,
  options: {
    claimId: string;
    adminId: string;
    action: 'confirm_paid' | 'reject';
    resolutionNotes: string;
    requestId?: string | null;
  },
): Promise<{ claim: { id: string; status: string }; intent: { id: string; status: string } }> {
  return db.transaction(async (tx) => {
    const claimRows = await tx
      .select()
      .from(claims)
      .where(eq(claims.id, options.claimId))
      .for('update')
      .limit(1);
    const claim = claimRows[0];
    if (!claim) {
      throw new AppError(404, 'NOT_FOUND', 'Claim not found.');
    }
    if (claim.status !== 'payment_review') {
      throw new AppError(409, 'CLAIM_NOT_IN_REVIEW', 'This claim is not awaiting review.');
    }
    const intentRows = await tx
      .select()
      .from(paymentIntents)
      .where(eq(paymentIntents.claimId, claim.id))
      .limit(1);
    const intent = intentRows[0];
    if (!intent) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    const now = new Date();
    if (options.action === 'confirm_paid') {
      // Admin override: no chain re-check (locked decision).
      await tx
        .update(paymentIntents)
        .set({ status: 'verified', verifiedAt: now, updatedAt: now })
        .where(eq(paymentIntents.id, intent.id));
      await tx
        .update(claims)
        .set({ status: 'paid', updatedAt: now })
        .where(and(eq(claims.id, claim.id), eq(claims.status, 'payment_review')));
      await writeAuditEvent(tx, {
        actorUserId: options.adminId,
        eventType: 'payment_review.resolved',
        entityType: 'claim',
        entityId: claim.id,
        requestId: options.requestId ?? null,
        metadata: {
          action: 'confirm_paid',
          intentId: intent.id,
          from: 'payment_review',
          to: 'paid',
          resolutionNotes: options.resolutionNotes,
        },
      });
      return {
        claim: { id: claim.id, status: 'paid' },
        intent: { id: intent.id, status: 'verified' },
      };
    }
    await tx
      .update(paymentIntents)
      .set({ status: 'rejected', updatedAt: now })
      .where(eq(paymentIntents.id, intent.id));
    await tx
      .update(claims)
      .set({ status: 'cancelled', updatedAt: now })
      .where(and(eq(claims.id, claim.id), eq(claims.status, 'payment_review')));
    // Restore inventory only when the slot is NOT cancelled: the slot may
    // have been admin-disabled (dead, available 0) while this claim waited.
    const slotRows = await tx.select().from(slots).where(eq(slots.id, claim.slotId)).limit(1);
    const slot = slotRows[0];
    let inventoryRestored = false;
    if (slot && slot.status !== 'cancelled') {
      const bumped = await tx
        .update(slots)
        .set({
          availableQuantity: sql`${slots.availableQuantity} + ${claim.quantity}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(slots.id, slot.id),
            sql`${slots.availableQuantity} + ${claim.quantity} <= ${slots.totalQuantity}`,
          ),
        )
        .returning({ availableQuantity: slots.availableQuantity, status: slots.status });
      if (bumped.length > 0) {
        inventoryRestored = true;
        if (bumped[0]?.status === 'sold_out' && (bumped[0]?.availableQuantity ?? 0) > 0) {
          await tx.update(slots).set({ status: 'published', updatedAt: now }).where(eq(slots.id, slot.id));
        }
      }
    }
    await writeAuditEvent(tx, {
      actorUserId: options.adminId,
      eventType: 'payment_review.resolved',
      entityType: 'claim',
      entityId: claim.id,
      requestId: options.requestId ?? null,
      metadata: {
        action: 'reject',
        intentId: intent.id,
        from: 'payment_review',
        to: 'cancelled',
        resolutionNotes: options.resolutionNotes,
        inventoryRestored,
      },
    });
    return {
      claim: { id: claim.id, status: 'cancelled' },
      intent: { id: intent.id, status: 'rejected' },
    };
  });
}

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

export interface AuditEventView {
  id: string;
  actor: { id: string; walletDisplay: string } | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  request_id: string | null;
}

export interface AuditEventsFilter {
  eventType?: string;
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  since?: Date;
  until?: Date;
  limit: number;
  offset: number;
}

export async function listAuditEvents(
  db: Db,
  filter: AuditEventsFilter,
): Promise<{ events: AuditEventView[]; total: number }> {
  const conditions = [];
  if (filter.eventType !== undefined) conditions.push(eq(auditEvents.eventType, filter.eventType));
  if (filter.entityType !== undefined) conditions.push(eq(auditEvents.entityType, filter.entityType));
  if (filter.entityId !== undefined) conditions.push(eq(auditEvents.entityId, filter.entityId));
  if (filter.actorUserId !== undefined) conditions.push(eq(auditEvents.actorUserId, filter.actorUserId));
  if (filter.since !== undefined) conditions.push(gte(auditEvents.createdAt, filter.since));
  if (filter.until !== undefined) conditions.push(lte(auditEvents.createdAt, filter.until));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select({ event: auditEvents })
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(filter.limit)
    .offset(filter.offset);
  const totalRows = await db.select({ value: count() }).from(auditEvents).where(where);
  const views: AuditEventView[] = [];
  for (const { event } of rows) {
    let actor: AuditEventView['actor'] = null;
    if (event.actorUserId !== null) {
      const actorRows = await db
        .select({ id: users.id, walletAddress: users.walletAddress })
        .from(users)
        .where(eq(users.id, event.actorUserId))
        .limit(1);
      if (actorRows[0]) {
        actor = {
          id: actorRows[0].id,
          walletDisplay: truncateWalletAddress(actorRows[0].walletAddress),
        };
      }
    }
    views.push({
      id: event.id,
      actor,
      event_type: event.eventType,
      entity_type: event.entityType,
      entity_id: event.entityId,
      metadata: (event.metadata ?? null) as Record<string, unknown> | null,
      created_at: event.createdAt.toISOString(),
      request_id: event.requestId,
    });
  }
  return { events: views, total: totalRows[0]?.value ?? 0 };
}
