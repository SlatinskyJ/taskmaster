import { eq } from 'drizzle-orm'
import { copyDay } from '~/domain'
import type { Item, Reservation } from '~/domain'
import { parseIsoUtc, toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import { tasks } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { closeThread } from './thread'

// A task row (one-time task or instance) and the domain's `Item` (src/domain/lifecycle.ts), both ways, and the one
// place that writes a task's state: every lifecycle step and every agreement saves through
// `saveItem`, so a task that leaves `proposed` always closes its negotiation thread.

/**
 * The domain's view of a task row. Only states past agreement have lifecycle meaning here.
 * `dayRules` (the `weekPlan` switch, read by the caller at its entry point) fills `day` for a
 * week-plan copy whose rules still apply (spec §5.12); off, every row follows the old rules.
 */
export function toItem(row: TaskRow, dayRules: boolean): Item {
  const base = {
    origin: row.origin,
    approvalRequired: row.approvalRequired,
    deadline:
      row.dueAt !== null && row.graceEndsAt !== null
        ? { dueAt: parseIsoUtc(row.dueAt), graceEndsAt: parseIsoUtc(row.graceEndsAt) }
        : null,
    day:
      dayRules && row.weekRules && row.planDayAt !== null
        ? copyDay(parseIsoUtc(row.planDayAt))
        : null,
  }
  const reservation = reservationOf(row)
  switch (row.status) {
    case 'proposed':
    case 'open':
    case 'cancelled':
    case 'expired':
      return { ...base, status: row.status }
    case 'reserved':
      if (!reservation) throw new Error(`task ${String(row.id)} reserved without a taker`)
      return { ...base, status: 'reserved', reservation }
    case 'done_unconfirmed':
    case 'confirmed':
    case 'rejected': {
      if (row.completedBy === null || row.completedAt === null) {
        throw new Error(`task ${String(row.id)} completed without completion data`)
      }
      const completion = {
        completedBy: row.completedBy,
        completedAt: parseIsoUtc(row.completedAt),
        earner: row.earnerId,
        reservation,
      }
      return { ...base, status: row.status, completion }
    }
  }
}

function reservationOf(row: TaskRow): Reservation | null {
  if (row.reservedBy === null) return null
  if (row.reservedVia === 'bid' && row.reservedGiverId !== null) {
    return { takerId: row.reservedBy, via: 'bid', giverId: row.reservedGiverId }
  }
  return { takerId: row.reservedBy, via: 'tap' }
}

/** Column values for an item's state. Reservation columns double as the completion's snapshot. */
export function columnsOf(item: Item) {
  const none = {
    reservedBy: null,
    reservedVia: null,
    reservedGiverId: null,
    completedBy: null,
    completedAt: null,
    earnerId: null,
  }
  const res = (r: Reservation | null) =>
    r
      ? {
          reservedBy: r.takerId,
          reservedVia: r.via,
          reservedGiverId: r.via === 'bid' ? r.giverId : null,
        }
      : { reservedBy: null, reservedVia: null, reservedGiverId: null }
  switch (item.status) {
    case 'proposed':
    case 'open':
    case 'cancelled':
    case 'expired':
      return { status: item.status, ...none }
    case 'reserved':
      return { status: item.status, ...none, ...res(item.reservation) }
    case 'done_unconfirmed':
    case 'confirmed':
    case 'rejected':
      return {
        status: item.status,
        ...res(item.completion.reservation),
        completedBy: item.completion.completedBy,
        completedAt: toIsoUtc(item.completion.completedAt),
        earnerId: item.completion.earner,
      }
  }
}

/** Extra columns a save may set besides the item's state. */
export interface SaveOptions {
  set?: { score?: number; agreedAt?: string | null; offerRound?: number }
  /** Thread rows the task was agreed at, closed as `accepted` when it leaves `proposed`. */
  accepted?: readonly number[]
  /** A reopened round (#212) ends although the task stays open: it agreed, or was turned down. */
  endBidding?: boolean
}

/**
 * Saves `item` as the task's new state (plus `opts.set` and `updatedAt`). When the task leaves
 * `proposed`, its thread closes: `opts.accepted` as accepted, every other open row as closed. A
 * reopened round (#212) ends the same way, and `bidding_from` goes back to null, when the task
 * leaves `open` (reserved, done, cancelled) or `opts.endBidding` says so. The one writer of that.
 */
export function saveItem(
  tx: Tx,
  before: TaskRow,
  item: Item,
  opts: SaveOptions,
  now: Date,
): { row: TaskRow; accepted: number[]; closed: number[] } {
  const leftProposed = before.status === 'proposed' && item.status !== 'proposed'
  const roundEnds =
    before.biddingFrom !== null && (item.status !== 'open' || opts.endBidding === true)
  const row = tx
    .update(tasks)
    .set({
      ...columnsOf(item),
      ...opts.set,
      ...(roundEnds ? { biddingFrom: null } : {}),
      updatedAt: toIsoUtc(now),
    })
    .where(eq(tasks.id, before.id))
    .returning()
    .get()
  const ended =
    leftProposed || roundEnds
      ? closeThread(tx, before.id, opts.accepted ?? [], now)
      : { accepted: [], closed: [] }
  return { row, ...ended }
}
