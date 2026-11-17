import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { users } from './users'

// Login sessions (spec §6, §11 Auth). One row per signed-in device. The cookie holds a random
// token; only its SHA-256 lands here, so a leaked DB or backup can't be replayed as a login.
// Rows are deleted on logout, password reset and expiry: sessions are not domain data, and the
// audit log keeps the history (auth.login_succeeded / auth.logout).
/** How the session was opened. Passkeys (#29) and the tablet name+PIN (stretch) add values. */
export const SESSION_METHODS = ['password'] as const
export type SessionMethod = (typeof SESSION_METHODS)[number]

export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** SHA-256 of the cookie token, hex. Never the token itself. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    // No CHECK on purpose: a new login method must not need a table rebuild.
    method: text('method', { enum: SESSION_METHODS }).notNull(),
    /** UTC instants, ISO 8601 with milliseconds. */
    createdAt: text('created_at').notNull(),
    /** Last time the session was used, rounded to renewals (see ~/server/auth/sessions). */
    lastSeenAt: text('last_seen_at').notNull(),
    /** Sliding: moves forward on use. Past it, the session is dead and gets deleted. */
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

export type SessionRow = typeof sessions.$inferSelect

// Failed logins, for the rate limit (spec §11: per user and per IP, kept in SQLite). One row
// per failure and key; rows older than the window are pruned on the next attempt.
export const loginFailures = sqliteTable(
  'login_failures',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** `user:<username as typed, lowercased>` or `ip:<address>`. */
    key: text('key').notNull(),
    at: text('at').notNull(),
  },
  (t) => [index('login_failures_key_at_idx').on(t.key, t.at)],
)
