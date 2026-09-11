// Phase 10: abuse-report creation. Any authenticated user may report a slot
// or a user (at least one target required). Self-reports are rejected. Audit
// report.created is written inside the same transaction as the report row.
import { eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { reports, slots, users } from '../../../../db/schema';
import { writeAuditEvent } from '../audit/events';
import { AppError } from '../http/errors';
import type { ReportCreateInput } from './validation';
import { hasReportTarget } from './validation';

type Db = ReturnType<typeof getDb>;
type ReportRow = typeof reports.$inferSelect;

export interface ReportView {
  id: string;
  slot_id: string | null;
  target_user_id: string | null;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
}

export function toReportView(row: ReportRow): ReportView {
  return {
    id: row.id,
    slot_id: row.slotId,
    target_user_id: row.targetUserId,
    reason: row.reason,
    details: row.details,
    status: row.status,
    created_at: row.createdAt.toISOString(),
  };
}

export async function createReport(
  db: Db,
  options: { reporterId: string; input: ReportCreateInput; requestId?: string | null },
): Promise<ReportView> {
  const { reporterId, input } = options;
  if (!hasReportTarget(input)) {
    throw new AppError(400, 'INVALID_INPUT', 'Report a slot or a user.');
  }
  return db.transaction(async (tx) => {
    if (input.slotId !== undefined) {
      const slotRows = await tx.select().from(slots).where(eq(slots.id, input.slotId)).limit(1);
      const slot = slotRows[0];
      if (!slot) {
        throw new AppError(404, 'NOT_FOUND', 'Slot not found.');
      }
      if (slot.providerId === reporterId) {
        throw new AppError(400, 'INVALID_INPUT', 'You cannot report your own listing.');
      }
    }
    if (input.targetUserId !== undefined) {
      if (input.targetUserId === reporterId) {
        throw new AppError(400, 'INVALID_INPUT', 'You cannot report yourself.');
      }
      const userRows = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.targetUserId))
        .limit(1);
      if (!userRows[0]) {
        throw new AppError(404, 'NOT_FOUND', 'User not found.');
      }
    }
    const inserted = await tx
      .insert(reports)
      .values({
        reporterId,
        slotId: input.slotId ?? null,
        targetUserId: input.targetUserId ?? null,
        reason: input.reason,
        details: input.details ?? null,
        status: 'open',
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    await writeAuditEvent(tx, {
      actorUserId: reporterId,
      eventType: 'report.created',
      entityType: 'report',
      entityId: row.id,
      requestId: options.requestId ?? null,
      metadata: {
        ...(input.slotId !== undefined ? { slotId: input.slotId } : {}),
        ...(input.targetUserId !== undefined ? { targetUserId: input.targetUserId } : {}),
        reason: input.reason,
      },
    });
    return toReportView(row);
  });
}
