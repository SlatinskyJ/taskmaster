import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import type { LiveSub } from './subscription'
import type { Topic } from './topics'

// A data function's live definition (#299, ./README.md "Subscribing"). Kept free of server-only
// imports: a module's definitions stay in the client bundle beside its server functions (only
// the handlers are stripped), so this module and ./topics.ts are what a `functions.ts` imports
// at module level; `serveLive` (./read.ts) is used only inside handlers.

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
