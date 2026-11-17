import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// Small key/value store for facts about the database itself (e.g. when it was created).
// Not domain data: settings and users get their own tables (#26).
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
