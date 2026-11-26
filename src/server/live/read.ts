import type { CurrentUser } from '~/server/auth'
import { sessionToken } from '~/server/auth/http'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import { liveSubscriptionIn } from './subscription'
import type { LiveSub } from './subscription'
import type { Topic } from './topics'

// How a data function subscribes (#299, ./README.md "Subscribing"): its reads and its topics
// are one `liveRead` definition, and its server function's handler is
// `serveLive(def, context.user, data)`. `serveLive` reads, then signs, in one synchronous block,
// so no change can commit between the data and `asOf` (an `await` there could miss one).

type NotAsync<T> = T extends PromiseLike<unknown> ? never : T

/** What a data function returns: its data and the subscription for what it read. */
export interface Live<T> {
  data: T
  /** Null when the switch is off, there is no session, or the read named no topics. */
  live: LiveSub | null
}

export interface LiveRead<A, T> {
  /** The function's reads: synchronous, so nothing commits between them and the signing. */
  read: (db: Db, viewer: CurrentUser, arg: A, now: Date) => NotAsync<T>
  /**
   * The topics of what `read` returned, for this viewer: only what its own checks let him load
   * (a per-row topic names a row of `data`). `[]` for nothing (a null read, a switch off).
   */
  topics: (viewer: CurrentUser, data: T, db: Db) => readonly Topic[]
}

/** Identity, for type inference of a definition. */
export function liveRead<A, T>(def: LiveRead<A, T>): LiveRead<A, T> {
  return def
}

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
