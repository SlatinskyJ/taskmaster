import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { taskThread } from '~/server/db/schema'
import type { ThreadRow } from '~/server/db/schema'

// The negotiation thread of a one-time task (spec §5.2): giver-side offers and takers' bids.
// Reads and writes rows only; the rules live in src/domain and the actions in ./bidding.

export interface NewEntry {
  taskId: number
  userId: number
  side: ThreadRow['side']
  score: number
}

const open = (taskId: number) => and(eq(taskThread.taskId, taskId), isNull(taskThread.closedAt))

/**
 * Adds an offer or a bid. The open row it supersedes (giver side: the task's open offer; taker
 * side: that taker's open bid) is closed as `replaced` first.
 */
export function addEntry(
  tx: Tx,
  entry: NewEntry,
  now: Date,
): { entry: ThreadRow; replaced: ThreadRow | null } {
  const at = toIsoUtc(now)
  const same =
    entry.side === 'giver'
      ? and(open(entry.taskId), eq(taskThread.side, 'giver'))
      : and(open(entry.taskId), eq(taskThread.side, 'taker'), eq(taskThread.userId, entry.userId))
  const replaced =
    tx
      .update(taskThread)
      .set({ closedAt: at, closedAs: 'replaced' })
      .where(same)
      .returning()
      .all()
      .at(0) ?? null
  const added = tx
    .insert(taskThread)
    .values({ ...entry, createdAt: at })
    .returning()
    .get()
  return { entry: added, replaced }
}

/** The task's current offer. A proposed task always has one. */
export function openOffer(db: Db | Tx, taskId: number): ThreadRow {
  const row = openOfferOrNull(db, taskId)
  if (!row) throw new Error(`task ${String(taskId)} proposed without an open offer`)
  return row
}

/** The open giver row, if any: a reopened round has none until a giver counters (#212). */
export function openOfferOrNull(db: Db | Tx, taskId: number): ThreadRow | null {
  return (
    db
      .select()
      .from(taskThread)
      .where(and(open(taskId), eq(taskThread.side, 'giver')))
      .get() ?? null
  )
}

/** The task's open bids, oldest first. */
export function openBids(db: Db | Tx, taskId: number): ThreadRow[] {
  return db
    .select()
    .from(taskThread)
    .where(and(open(taskId), eq(taskThread.side, 'taker')))
    .orderBy(asc(taskThread.id))
    .all()
}

/**
 * Each taker's newest bid since the newest giver row (a counter, a re-offer, a turn-down), open
 * or closed: the same-number rule (spec §5.2, Jakub 2026-11-24). In a reopened round (#212) only
 * rows above `since` (its start) count: the floor is the newer of the two. Oldest first.
 */
export function lastBids(db: Db | Tx, taskId: number, since = 0): ThreadRow[] {
  const giver = db
    .select({ id: taskThread.id })
    .from(taskThread)
    .where(and(eq(taskThread.taskId, taskId), eq(taskThread.side, 'giver')))
    .orderBy(desc(taskThread.id))
    .get()
  const rows = db
    .select()
    .from(taskThread)
    .where(
      and(
        eq(taskThread.taskId, taskId),
        eq(taskThread.side, 'taker'),
        gt(taskThread.id, Math.max(since, giver?.id ?? 0)),
      ),
    )
    .orderBy(asc(taskThread.id))
    .all()
  const newest = new Map(rows.map((r) => [r.userId, r]))
  return [...newest.values()].sort((a, b) => a.id - b.id)
}

/**
 * The negotiation ended: every open row closes, as `accepted` for the ids given (the number the
 * task was agreed at) and `closed` for the rest. Returns the ids of each kind, ascending.
 */
export function closeThread(
  tx: Tx,
  taskId: number,
  accepted: readonly number[],
  now: Date,
): { accepted: number[]; closed: number[] } {
  const at = toIsoUtc(now)
  const rows = tx.select().from(taskThread).where(open(taskId)).orderBy(asc(taskThread.id)).all()
  const result = { accepted: [] as number[], closed: [] as number[] }
  for (const r of rows) {
    const closedAs = accepted.includes(r.id) ? 'accepted' : 'closed'
    tx.update(taskThread).set({ closedAt: at, closedAs }).where(eq(taskThread.id, r.id)).run()
    result[closedAs].push(r.id)
  }
  return result
}

/** Every row of the task's thread, oldest first. */
export function threadOf(db: Db | Tx, taskId: number): ThreadRow[] {
  return db
    .select()
    .from(taskThread)
    .where(eq(taskThread.taskId, taskId))
    .orderBy(asc(taskThread.id))
    .all()
}

/** Closes the given rows as `closed`: a taker's Nechci, a giver's turn-down (#208). */
export function closeRows(tx: Tx, ids: readonly number[], now: Date) {
  if (ids.length === 0) return
  tx.update(taskThread)
    .set({ closedAt: toIsoUtc(now), closedAs: 'closed' })
    .where(inArray(taskThread.id, [...ids]))
    .run()
}
