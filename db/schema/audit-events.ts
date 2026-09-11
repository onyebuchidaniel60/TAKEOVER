import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    requestId: text('request_id'),
    // Never store secrets, signatures, cookies, or credentials here (ARCHITECTURE.md s9).
    metadata: jsonb('metadata').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_entity_idx').on(t.entityType, t.entityId)],
);
