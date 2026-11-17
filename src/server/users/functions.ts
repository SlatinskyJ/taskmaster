import { createServerFn } from '@tanstack/react-start'
import { asc } from 'drizzle-orm'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { users } from '~/server/db/schema'

// Server functions for the admin console (#47). Admin only.

/** Everyone, for the people list on Správa. Never the password hash. */
export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(() =>
    getDb()
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        role: users.role,
        active: users.active,
      })
      .from(users)
      .orderBy(asc(users.id))
      .all(),
  )
