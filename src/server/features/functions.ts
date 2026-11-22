import { createServerFn } from '@tanstack/react-start'
import { requireUser } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { getFlags } from './flags'

// Server functions screens may import (see the ESLint rule for src/routes).

/** The launch switches, for the app shell (src/routes/_app.tsx). Signed-in users only. */
export const getFeaturesFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(() => getFlags(getDb()))
