import { desc } from 'drizzle-orm'
import type { Role } from '~/domain'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { disputes, users } from '~/server/db/schema'
import { toMark } from './disputes'
import type { DisputeMark } from './disputes'
import { loadTarget } from './targets'
import type { DisputeItem } from './targets'

// Rozporováno (#46, plan Decision 5b): the disputes a viewer is involved in, on Týden →
// Historie, so an outcome stays visible after its week. A giver sees every dispute; a taker the
// ones he opened, the ones on his own completions, rejections and settlements, and every score
// dispute (scores are shared by all parties). Every open one, plus the newest closed ones.

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

export function listDisputes(db: Db | Tx, viewer: { id: number; role: Role }): DisputeListEntry[] {
  if (viewer.role !== 'giver' && viewer.role !== 'taker') return []
  const names = new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .all()
      .map((u) => [u.id, u.name]),
  )
  const out: DisputeListEntry[] = []
  let closed = 0
  // Newest first; the viewer filter runs here in code, before the cap, so other boys'
  // disputes never take a taker's places.
  for (const r of db
    .select()
    .from(disputes)
    .orderBy(desc(disputes.openedAt), desc(disputes.id))
    .all()) {
    if (r.status !== 'open' && closed >= DISPUTE_LIST_CLOSED_MAX) continue
    const item = { kind: r.itemKind, id: r.itemId }
    const about = loadTarget(db, item)?.about ?? null
    const takerId = about?.takerId ?? null
    const visible =
      viewer.role === 'giver' ||
      r.openedBy === viewer.id ||
      takerId === null ||
      takerId === viewer.id
    if (!visible) continue
    if (r.status !== 'open') closed++
    out.push({
      id: r.id,
      item,
      title: about?.title ?? '',
      week: about?.week ?? null,
      takerName: takerId === null ? null : (names.get(takerId) ?? null),
      openedByName: names.get(r.openedBy) ?? '',
      reason: r.reason,
      openedAt: r.openedAt,
      mark: toMark(r),
    })
  }
  return out
}
