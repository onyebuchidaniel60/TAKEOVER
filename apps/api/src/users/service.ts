// Self-service avatar update. The avatar is a base64 data URI stored on
// the user row (see db/schema/users.ts); null clears it. Same-value
// re-sets are a no-op (no write, no audit). The audit carries IDs only,
// never the image data. Input arrives API-validated (data-URI shape,
// 200KB cap); the service trusts the boundary per the lifecycle-layer
// convention.
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../../db/client';
import { users } from '../../../../db/schema';
import { writeAuditEvent } from '../audit/events';
import { AppError } from '../http/errors';

type Db = ReturnType<typeof getDb>;

export async function setUserAvatar(
  db: Db,
  userId: string,
  avatarData: string | null,
  audit?: { requestId?: string | null },
): Promise<string | null> {
  const row = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new AppError(404, 'NOT_FOUND', 'User not found.');
    }
    if (current.avatarData === avatarData) {
      return current;
    }
    const updated = await tx
      .update(users)
      .set({ avatarData, updatedAt: new Date() })
      .where(and(eq(users.id, userId)))
      .returning();
    const next = updated[0];
    if (!next) {
      throw new AppError(500, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    await writeAuditEvent(tx, {
      actorUserId: userId,
      eventType: 'user.avatar_updated',
      entityType: 'user',
      entityId: next.id,
      requestId: audit?.requestId ?? null,
      metadata: { hadAvatar: current.avatarData !== null },
    });
    return next;
  });
  return row.avatarData;
}
