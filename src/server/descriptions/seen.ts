import type { Db } from '~/server/db'
import { getFlags } from '~/server/features'

// The text a brother's yes or bid saw (#207), shared by the task and chore server functions.

/** What a yes or bid call sends: the description on the page, `null` when it had none. */
export interface Seen {
  seenDescription?: string | null
}

/** The page's text, checked only with the switch on (ruling 8). */
export const seenOf = (db: Db, data: Seen) =>
  getFlags(db).descriptions ? data.seenDescription : undefined

/**
 * Ruling 2: with the switch on a brother's yes or bid must say what text it saw. One without it
 * comes from a page loaded before the switch or the deploy: refused as stale.
 */
export const unseen = (db: Db, data: Seen) =>
  getFlags(db).descriptions && data.seenDescription === undefined

export const STALE = { ok: false, error: 'offer_changed' } as const
