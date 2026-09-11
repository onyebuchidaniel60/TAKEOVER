// Phase 10: audit event helper. Every audit row is written INSIDE the same DB
// transaction as the action it describes — audit and action succeed or fail
// together. Never a best-effort side write.
//
// Privacy rule: metadata carries IDs, prior/new states, and reason strings
// only. NEVER full wallet addresses, tx hashes, session tokens, signatures,
// cookies, or PII. Full wallets live in entity_id only where the entity IS a
// user row reference pattern allows it — otherwise in the referenced row.
import { getDb } from '../../../../db/client';
import { auditEvents } from '../../../../db/schema';

type Db = ReturnType<typeof getDb>;
/** Minimal surface needed to insert: satisfied by both db and tx objects. */
export type AuditTx = Pick<Db, 'insert'>;

export interface WriteAuditOptions {
  actorUserId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Insert one audit_events row using the caller's transaction handle. */
export async function writeAuditEvent(
  tx: AuditTx,
  options: WriteAuditOptions,
): Promise<void> {
  await tx.insert(auditEvents).values({
    actorUserId: options.actorUserId,
    eventType: options.eventType,
    entityType: options.entityType,
    entityId: options.entityId,
    requestId: options.requestId ?? null,
    metadata: options.metadata ?? null,
  });
}
