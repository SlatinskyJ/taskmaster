import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { ACTOR_KINDS, AUDIT_ACTIONS, ENTITY_TYPES } from '~/server/audit/actions'

// Append-only audit log (spec §5.10). Rows are only ever inserted, through `withAudit` /
// `writeAudit` in ~/server/audit. DB triggers (migration 0002) reject UPDATE and DELETE.
// Ids are plain values, not foreign keys: the log must never block or cascade from other tables.
//
// WARNING: if a schema change here makes drizzle-kit rebuild this table (`__new_audit_log` +
// DROP + rename), the rebuild drops the triggers. Re-create them in the same migration, and
// copy the rows with INSERT ... SELECT (allowed; only UPDATE/DELETE are blocked).
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** UTC instant, ISO 8601 with milliseconds (`2026-11-16T18:00:00.000Z`). */
    at: text('at').notNull(),
    actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull(),
    /** Set when actorKind is `user`, null otherwise. */
    actorUserId: integer('actor_user_id'),
    action: text('action', { enum: AUDIT_ACTIONS }).notNull(),
    entityType: text('entity_type', { enum: ENTITY_TYPES }).notNull(),
    entityId: text('entity_id').notNull(),
    /** JSON: the entity's relevant values before the change (null for creations). */
    before: text('before'),
    /** JSON: the values after the change, or the action's payload. */
    after: text('after'),
    reason: text('reason'),
    /**
     * Groups the entries of one change (#299, ~/server/audit README): null on a change's first
     * entry, that entry's id on every later one. A change's key is `change_id ?? id`.
     */
    changeId: integer('change_id'),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_at_idx').on(t.at),
    /** The catch-up finds a change's entries by its key (#299, src/server/live/hub.ts). */
    index('audit_log_change_idx').on(t.changeId),
    check('audit_log_actor_check', sql`(${t.actorKind} = 'user') = (${t.actorUserId} IS NOT NULL)`),
    check('audit_log_before_json', sql`${t.before} IS NULL OR json_valid(${t.before})`),
    check('audit_log_after_json', sql`${t.after} IS NULL OR json_valid(${t.after})`),
  ],
)
