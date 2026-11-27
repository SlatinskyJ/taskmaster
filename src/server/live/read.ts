import type { CurrentUser } from '~/server/auth'
import { sessionToken } from '~/server/auth/http'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import { liveSubscriptionIn } from './subscription'
import type { Live, LiveRead } from './define'

export { liveRead } from './define'
export type { Live, LiveRead } from './define'

// How a data function subscribes (#299, ./README.md "Subscribing"): its reads and its topics
// are one `liveRead` definition (./define.ts), and its server function's handler is
// `serveLive(def, context.user, data)`. `serveLive` reads, then signs, in one synchronous block,
// so no change can commit between the data and `asOf` (an `await` there could miss one).

/** `serveLive`'s body, with what it reads from the request passed in. */
export function serveLiveIn<A, T>(
  db: Db,
  key: string | undefined,
  def: LiveRead<A, T>,
  viewer: CurrentUser,
  arg: A,
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
): Live<T> {
  const data = def.read(db, viewer, arg, now)
  const topics = [...new Set(def.topics(viewer, data, db))].sort()
  const live = topics.length === 0 ? null : liveSubscriptionIn(db, key, viewer, topics, env)
  return { data, live }
}

/** Runs a data function's reads for the request's viewer and signs the topics they read. */
export function serveLive<A, T>(
  def: LiveRead<A, T>,
  viewer: CurrentUser,
  arg: A,
  now?: Date,
): Live<T> {
  return serveLiveIn(getDb(), sessionToken(), def, viewer, arg, now ?? new Date(), process.env)
}
