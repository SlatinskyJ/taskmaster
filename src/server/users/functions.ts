import { createServerFn } from '@tanstack/react-start'
import { requireRole } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { listUsers } from './people'

// Server functions for the admin console (#47). Admin only.

/** Everyone, for the people list on Správa. Never the password hash (see `listUsers`). */
export const listUsersFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(() => listUsers(getDb()))
