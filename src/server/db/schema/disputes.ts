import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { users } from './users'

// Disputes on locked items (spec §5.11, #46). The rules are the domain's
// (src/domain/disputes.ts); the store is src/server/disputes/. `item_kind` + `item_id` name the
// disputed record (src/server/disputes/README.md has the keys). Rows are never deleted and
// `status` moves from open to one closed state once (triggers in migration 0023). The partial
// unique index backs up "[call] at most one open dispute per item". Times are UTC ISO 8601 with
// milliseconds. `adjustment` is listed for #48 (no adjustments table yet).
export const DISPUTE_KINDS = [
  'task_score',
  'template_score',
  'completion',
  'rejection',
  'settlement',
  'adjustment',
] as const
export const DISPUTE_STATUSES = ['open', 'dismissed', 'corrected'] as const

export const disputes = sqliteTable(
  'disputes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    itemKind: text('item_kind', { enum: DISPUTE_KINDS }).notNull(),
    itemId: integer('item_id').notNull(),
    openedBy: integer('opened_by')
      .notNull()
      .references(() => users.id),
    /** Stored trimmed, 1–200 characters. */
    reason: text('reason').notNull(),
    openedAt: text('opened_at').notNull(),
    status: text('status', { enum: DISPUTE_STATUSES }).notNull(),
    /** The admin who closed it, when, and the note; all null while open. */
    resolvedBy: integer('resolved_by').references(() => users.id),
    resolvedAt: text('resolved_at'),
    note: text('note'),
  },
  (t) => [
    check(
      'disputes_kind_check',
      sql`${t.itemKind} IN ('task_score', 'template_score', 'completion', 'rejection', 'settlement', 'adjustment')`,
    ),
    check('disputes_status_check', sql`${t.status} IN ('open', 'dismissed', 'corrected')`),
    check('disputes_reason_check', sql`length(trim(${t.reason})) BETWEEN 1 AND 200`),
    check(
      'disputes_resolution_check',
      sql`(${t.status} = 'open' AND ${t.resolvedBy} IS NULL AND ${t.resolvedAt} IS NULL AND ${t.note} IS NULL) OR (${t.status} <> 'open' AND ${t.resolvedBy} IS NOT NULL AND ${t.resolvedAt} IS NOT NULL AND ${t.note} IS NOT NULL)`,
    ),
    check(
      'disputes_note_check',
      sql`${t.status} = 'open' OR length(trim(coalesce(${t.note}, ''))) > 0`,
    ),
    uniqueIndex('disputes_one_open_idx')
      .on(t.itemKind, t.itemId)
      .where(sql`${t.status} = 'open'`),
    index('disputes_item_idx').on(t.itemKind, t.itemId),
  ],
)

export type DisputeRow = typeof disputes.$inferSelect
