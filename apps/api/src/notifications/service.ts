// In-app notifications. Two events only: a funded escrow
// (the provider is told to deliver) and a delivered escrow (the buyer is
// told to confirm). Rows are written INSIDE the same DB transaction as the
// state change they describe — notification and action succeed or fail
// together. Never a best-effort side write.
//
// Privacy rule: bodies carry display text only (slot titles, truncated
// identifiers). NEVER full wallet addresses, tx hashes, session tokens,
// signatures, cookies, or PII.
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { notifications } from '../../../../db/schema';
import { AppError } from '../http/errors';

type Db = ReturnType<typeof getDb>;
/** Minimal surface needed to insert: satisfied by both db and tx objects. */
export type NotificationTx = Pick<Db, 'insert'>;

export const NOTIFICATION_TYPES = ['slot_funded', 'slot_delivered'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_ENTITY_TYPES = ['claim', 'slot', 'escrow'] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPES)[number];

export interface NotificationInput {
  userId: string;
  type: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
}

/** Validate a notification before writing. Programmer errors fail closed. */
export function validateNotificationInput(input: NotificationInput): void {
  if (!(NOTIFICATION_TYPES as readonly string[]).includes(input.type)) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  if (!(NOTIFICATION_ENTITY_TYPES as readonly string[]).includes(input.entityType)) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  if (
    typeof input.userId !== 'string' ||
    input.userId.length === 0 ||
    typeof input.entityId !== 'string' ||
    input.entityId.length === 0 ||
    typeof input.title !== 'string' ||
    input.title.trim().length === 0 ||
    typeof input.body !== 'string' ||
    input.body.trim().length === 0
  ) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
}

/** Insert one notifications row using the caller's transaction handle. */
export async function writeNotification(
  tx: NotificationTx,
  input: NotificationInput,
): Promise<{ id: string }> {
  validateNotificationInput(input);
  const rows = await tx
    .insert(notifications)
    .values({
      userId: input.userId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      title: input.title,
      body: input.body,
    })
    .returning({ id: notifications.id });
  const row = rows[0];
  if (!row) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
  }
  return { id: row.id };
}

export interface NotificationView {
  id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

type NotificationRow = typeof notifications.$inferSelect;

export function toNotificationView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    entity_type: row.entityType,
    entity_id: row.entityId,
    title: row.title,
    body: row.body,
    read_at: row.readAt ? row.readAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}

const LIST_LIMIT = 50;

/** Newest-first page plus the unread count for the badge. Owner-scoped. */
export async function listNotifications(
  db: Db,
  userId: string,
): Promise<{ notifications: NotificationView[]; unreadCount: number }> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(LIST_LIMIT);
  const unread = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return {
    notifications: rows.map(toNotificationView),
    unreadCount: unread[0]?.value ?? 0,
  };
}

/**
 * Mark one notification read. Conditional write admits exactly one winner;
 * an already-read owned row is a 200 no-op. Returns the view, or null when
 * the row is missing or foreign (caller maps null → 404, never leaks).
 */
export async function markNotificationRead(
  db: Db,
  userId: string,
  id: string,
): Promise<NotificationView | null> {
  const now = new Date();
  const updated = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning();
  if (updated[0]) {
    return toNotificationView(updated[0]);
  }
  const existing = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .limit(1);
  return existing[0] ? toNotificationView(existing[0]) : null;
}

/** Mark every unread notification read. Returns the marked count. */
export async function markAllNotificationsRead(db: Db, userId: string): Promise<{ marked: number }> {
  const updated = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return { marked: updated.length };
}
