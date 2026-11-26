import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

// In-app suggestions (spec §5.13, #247). The rules are the domain's (src/domain/suggestions.ts);
// the store is src/server/suggestions/. Rows are never deleted, done and dismissed are final, the
// author's text and, once set, the sent text never change (triggers in migration 0040). Lengths
// count characters (code points), as SQLite's `length()` does. Times are UTC ISO 8601 with
// milliseconds.
export const SUGGESTION_STATUSES = ['new', 'sent', 'done', 'dismissed'] as const

export const suggestions = sqliteTable(
  'suggestions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    authorId: integer('author_id')
      .notNull()
      .references(() => users.id),
    /** Stored cleaned, 1–120 characters. */
    title: text('title').notNull(),
    /** Stored cleaned, 1–2000 characters; null = none. */
    description: text('description'),
    createdAt: text('created_at').notNull(),
    status: text('status', { enum: SUGGESTION_STATUSES }).notNull(),
    /** The GitHub issue and the text sent to it (footer included); all null until sent. */
    issueUrl: text('issue_url'),
    issueNumber: integer('issue_number'),
    sentTitle: text('sent_title'),
    sentBody: text('sent_body'),
    sentAt: text('sent_at'),
    /** The admin who marked it done or dismissed it, and when; null until then. */
    closedBy: integer('closed_by').references(() => users.id),
    closedAt: text('closed_at'),
  },
  (t) => [
    check('suggestions_status_check', sql`${t.status} IN ('new', 'sent', 'done', 'dismissed')`),
    check('suggestions_title_check', sql`length(${t.title}) BETWEEN 1 AND 120`),
    check(
      'suggestions_description_check',
      sql`${t.description} IS NULL OR length(${t.description}) BETWEEN 1 AND 2000`,
    ),
    check(
      'suggestions_sent_check',
      sql`(${t.issueUrl} IS NULL AND ${t.issueNumber} IS NULL AND ${t.sentTitle} IS NULL AND ${t.sentBody} IS NULL AND ${t.sentAt} IS NULL) OR (${t.issueUrl} IS NOT NULL AND ${t.issueNumber} IS NOT NULL AND ${t.sentTitle} IS NOT NULL AND ${t.sentBody} IS NOT NULL AND ${t.sentAt} IS NOT NULL)`,
    ),
    check(
      'suggestions_sent_status_check',
      sql`(${t.status} <> 'sent' OR ${t.issueUrl} IS NOT NULL) AND (${t.status} NOT IN ('new', 'dismissed') OR ${t.issueUrl} IS NULL)`,
    ),
    check(
      'suggestions_closed_check',
      sql`(${t.status} IN ('done', 'dismissed')) = (${t.closedBy} IS NOT NULL AND ${t.closedAt} IS NOT NULL) AND (${t.closedBy} IS NULL) = (${t.closedAt} IS NULL)`,
    ),
    index('suggestions_author_idx').on(t.authorId),
  ],
)

export type SuggestionRow = typeof suggestions.$inferSelect
