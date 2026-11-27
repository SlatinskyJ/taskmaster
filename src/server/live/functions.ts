import { createServerOnlyFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { clientIp, currentUser, sessionToken } from '~/server/auth/http'
import { findSession } from '~/server/auth/sessions'
import { getDb } from '~/server/db'
import { demoStreamSlot } from '~/server/demo/caps'
import { users } from '~/server/db/schema'
import { getFlags } from '~/server/features'
import { liveHub } from './hub'
import { openStream } from './stream'

export type { Live } from './define'
export type { LiveSub } from './subscription'
export type { LiveEvent } from './hub'

// The stream route's body (src/routes/api/live.ts, #299): reads the request and hands it to
// `openStream` (./stream.ts). Server only. Screens import the subscription types from here.

export const liveStreamResponse = createServerOnlyFn((request: Request): Response => {
  const url = new URL(request.url)
  const db = getDb()
  return openStream(
    {
      tokens: url.searchParams.getAll('t'),
      since: url.searchParams.get('since'),
      lastEventId: request.headers.get('last-event-id'),
      tab: url.searchParams.get('tab'),
    },
    {
      hub: liveHub,
      features: getFlags(db),
      currentUser: currentUser(),
      sessionKey: sessionToken(),
      findSession: (key) => findSession(db, key),
      findUser: (id) =>
        db
          .select({ active: users.active, role: users.role })
          .from(users)
          .where(eq(users.id, id))
          .get(),
      now: () => new Date(),
      setInterval: (run, ms) => setInterval(run, ms),
      clearInterval: (handle) => {
        clearInterval(handle as ReturnType<typeof setInterval>)
      },
      // The public demo's per-IP cap; none elsewhere.
      streamSlot: demoStreamSlot(process.env, clientIp()),
    },
  )
})
