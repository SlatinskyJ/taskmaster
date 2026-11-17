import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Accounts (spec §3, §6). Created and changed only by the admin through the family config
// (src/server/users), never by self-signup. Never deleted: a person who leaves is deactivated,
// so history and the audit log keep pointing at a real row.
export const USER_ROLES = ['taker', 'giver', 'admin'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Login name: lowercase, stable, unique. The config matches users by it. */
    username: text('username').notNull().unique(),
    /** Name shown in the app (Czech), e.g. "Táta". */
    displayName: text('display_name').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    /** Inactive people keep their history but can't log in or take part (spec §3). */
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    /** argon2id hash (PHC string); null until a password is set. Never logged. */
    passwordHash: text('password_hash'),
    /** UTC instants, ISO 8601 with milliseconds. */
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    check('users_role_check', sql`${t.role} IN ('taker', 'giver', 'admin')`),
    check('users_username_check', sql`${t.username} = lower(${t.username})`),
  ],
)

export type UserRow = typeof users.$inferSelect
