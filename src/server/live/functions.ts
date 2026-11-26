import { createServerOnlyFn } from '@tanstack/react-start'
import { currentUser, sessionToken } from '~/server/auth/http'
import { findSession } from '~/server/auth/sessions'
import { getDb } from '~/server/db'
import { getFlags } from '~/server/features'
import { liveHub } from './hub'
import { openStream } from './stream'

// The stream route's body (src/routes/api/live.ts, #299): reads the request and hands it to
// `openStream` (./stream.ts). Server only.

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
      hub: liveHub(),
      features: getFlags(db),
      currentUser: currentUser(),
      sessionKey: sessionToken(),
      findSession: (key) => findSession(db, key),
      now: () => new Date(),
      setInterval: (run, ms) => setInterval(run, ms),
      clearInterval: (handle) => {
        clearInterval(handle as ReturnType<typeof setInterval>)
      },
    },
  )
})
