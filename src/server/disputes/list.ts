import { and, asc, desc, eq, ne } from 'drizzle-orm'
import type { Role } from '~/domain'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { disputes, users } from '~/server/db/schema'
import type { DisputeRow } from '~/server/db/schema'
import { toMark } from './disputes'
import type { DisputeMark } from './disputes'
import { loadTarget } from './targets'
import type { DisputeItem, DisputeValue, ItemPage } from './targets'

// Rozporováno (#46): the disputes a viewer is involved in, on Týden →
// Historie, so an outcome stays visible after its week. A giver sees every dispute; a taker the
// ones he opened, the ones on his own completions, rejections and settlements, and every score
// dispute (scores are shared by all parties). Every open one, plus the most recently closed.
// Sporné on Správa (#47): the admin's queue, every open dispute with its item's value now.

/** How many closed disputes the list keeps (open ones are never cut). */
export const DISPUTE_LIST_CLOSED_MAX = 5

export interface DisputeListEntry {
  id: number
  item: DisputeItem
  /** The task or template title; '' for a settlement (its `week` names it). */
  title: string
  week: { startsAt: string; endsAt: string } | null
  /** Whose item it is (a completion, rejection or settlement); null for a score. */
  takerName: string | null
  openedByName: string
  reason: string
  openedAt: string
  mark: DisputeMark
}

/** A row of the admin's Sporné: what the item is and its value now (null: no longer loads). */
export type AdminDisputeEntry = Omit<DisputeListEntry, 'mark'> & {
  value: DisputeValue | null
  /** Whose item it is (#48: the fix sheet's boy); null for a score. Admin only. */
  takerId: number | null
  /** Where tapping the card opens the item (#222); null: no page (a settlement, an adjustment, a gone item). */
  page: ItemPage | null
}

interface Viewer {
  id: number
  role: Role
}

/**
 * Who sees a dispute: a giver every one; a taker those he opened, those on his own items, and
 * every score dispute (whose item has no taker).
 */
function visibleTo(viewer: Viewer, openedBy: number, takerId: number | null): boolean {
  if (viewer.role === 'giver') return true
  if (viewer.role !== 'taker') return false
  return openedBy === viewer.id || takerId === null || takerId === viewer.id
}

/** Whether `viewer` may see the disputes on `item` at all (a page's mark, #46): same rule. */
export function seesItemDisputes(db: Db | Tx, viewer: Viewer, item: DisputeItem): boolean {
  const takerId = loadTarget(db, item)?.about.takerId ?? null
  // Anyone else's opening counts as not his; then whether he opened one himself.
  if (visibleTo(viewer, 0, takerId)) return true
  const mine = db
    .select({ id: disputes.id })
    .from(disputes)
    .where(
      and(
        eq(disputes.itemKind, item.kind),
        eq(disputes.itemId, item.id),
        eq(disputes.openedBy, viewer.id),
      ),
    )
    .get()
  return mine !== undefined && visibleTo(viewer, viewer.id, takerId)
}

function userNames(db: Db | Tx): Map<number, string> {
  return new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .all()
      .map((u) => [u.id, u.name]),
  )
}

/** A dispute row with its item described; `takerId` decides who may see it. */
function describe(db: Db | Tx, names: Map<number, string>, r: DisputeRow) {
  const item = { kind: r.itemKind, id: r.itemId }
  const loaded = loadTarget(db, item)
  const takerId = loaded?.about.takerId ?? null
  return {
    takerId,
    value: loaded?.value ?? null,
    page: loaded?.about.page ?? null,
    entry: {
      id: r.id,
      item,
      title: loaded?.about.title ?? '',
      week: loaded?.about.week ?? null,
      takerName: takerId === null ? null : (names.get(takerId) ?? null),
      openedByName: names.get(r.openedBy) ?? '',
      reason: r.reason,
      openedAt: r.openedAt,
    },
  }
}

export function listDisputes(db: Db | Tx, viewer: Viewer): DisputeListEntry[] {
  if (viewer.role !== 'giver' && viewer.role !== 'taker') return []
  const names = userNames(db)
  const entry = (r: DisputeRow): DisputeListEntry | null => {
    const d = describe(db, names, r)
    if (!visibleTo(viewer, r.openedBy, d.takerId)) return null
    // An adjustment's reason is its title: only its own boy and the givers read it (§5.7).
    const hidden = r.itemKind === 'adjustment' && viewer.role === 'taker' && d.takerId !== viewer.id
    return { ...d.entry, ...(hidden ? { title: '' } : {}), mark: toMark(r) }
  }
  // The viewer filter runs before the cap, so other boys' disputes never take a taker's places.
  // Open ones newest opened first; then the most recently closed ones.
  const open = db
    .select()
    .from(disputes)
    .where(eq(disputes.status, 'open'))
    .orderBy(desc(disputes.openedAt), desc(disputes.id))
    .all()
    .flatMap((r) => entry(r) ?? [])
  const closed: DisputeListEntry[] = []
  for (const r of db
    .select()
    .from(disputes)
    .where(ne(disputes.status, 'open'))
    .orderBy(desc(disputes.resolvedAt), desc(disputes.id))
    .all()) {
    if (closed.length >= DISPUTE_LIST_CLOSED_MAX) break
    const e = entry(r)
    if (e) closed.push(e)
  }
  return [...open, ...closed]
}

/** The admin's queue: every open dispute, oldest opened first, with the item's value now. */
export function listOpenForAdmin(db: Db | Tx): AdminDisputeEntry[] {
  const names = userNames(db)
  return db
    .select()
    .from(disputes)
    .where(eq(disputes.status, 'open'))
    .orderBy(asc(disputes.openedAt), asc(disputes.id))
    .all()
    .map((r) => {
      const d = describe(db, names, r)
      return { ...d.entry, value: d.value, takerId: d.takerId, page: d.page }
    })
}
