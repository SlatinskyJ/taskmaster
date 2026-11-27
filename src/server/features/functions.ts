import { createServerFn } from '@tanstack/react-start'
import { requireRole, requireUser } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import { demoLock } from '~/server/demo/lock'
import { getFlags, parseSwitchInput, setSwitch } from './flags'

// Server functions screens may import (see the ESLint rule for src/routes).

/** The launch switches, for the app shell (src/routes/_app.tsx). Signed-in users only. */
export const getFeaturesFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(() => getFlags(getDb()))

/** Správa → Funkce: the admin turns one launch switch on or off (#296). */
export const setSwitchFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin'), demoLock])
  .validator(parseSwitchInput)
  .handler(({ data, context }) =>
    setSwitch(getDb(), context.user.id, data.key, data.enabled, new Date()),
  )
