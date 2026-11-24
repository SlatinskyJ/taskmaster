import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { templateThread } from '~/server/db/schema'
import type { TemplateThreadRow } from '~/server/db/schema'

// A template's bidding thread (spec §5.1): giver-side offers and takers' bids, on a proposed
// template's first score (#209) and on score changes of the agreed template.
// Reads and writes rows only; the rules live in src/domain and the actions in ./scoreChange.
// Same shape as src/server/tasks/thread.ts over its own table.

export interface NewEntry {
  templateId: number
  userId: number
  side: TemplateThreadRow['side']
  score: number
}

const open = (templateId: number) =>
  and(eq(templateThread.templateId, templateId), isNull(templateThread.closedAt))

/**
 * Adds an offer or a bid. The open row it supersedes (giver side: the template's one open offer,
 * whoever made it; taker side: that taker's open bid) is closed as `replaced` first.
 */
export function addEntry(
  tx: Tx,
  entry: NewEntry,
  now: Date,
): { entry: TemplateThreadRow; replaced: TemplateThreadRow | null } {
  const at = toIsoUtc(now)
  const same =
    entry.side === 'giver'
      ? and(open(entry.templateId), eq(templateThread.side, 'giver'))
      : and(
          open(entry.templateId),
          eq(templateThread.side, 'taker'),
          eq(templateThread.userId, entry.userId),
        )
  const replaced =
    tx
      .update(templateThread)
      .set({ closedAt: at, closedAs: 'replaced' })
      .where(same)
      .returning()
      .all()
      .at(0) ?? null
  const added = tx
    .insert(templateThread)
    .values({ ...entry, createdAt: at })
    .returning()
    .get()
  return { entry: added, replaced }
}

/** The change in flight: every open row, oldest first. Empty = no change. */
export function openRows(db: Db | Tx, templateId: number): TemplateThreadRow[] {
  return db
    .select()
    .from(templateThread)
    .where(open(templateId))
    .orderBy(asc(templateThread.id))
    .all()
}

/**
 * Each taker's newest bid since the newest giver row (a counter, a re-offer, a turn-down), open
 * or closed: the same-number rule (spec §5.2, Jakub 2026-11-24). Only rows above `since` count:
 * the floor is the newer of the two (a later caller passes the last row of an agreement, so
 * first-price bids never block a score change). Oldest first.
 */
export function lastBids(db: Db | Tx, templateId: number, since = 0): TemplateThreadRow[] {
  const giver = db
    .select({ id: templateThread.id })
    .from(templateThread)
    .where(and(eq(templateThread.templateId, templateId), eq(templateThread.side, 'giver')))
    .orderBy(desc(templateThread.id))
    .get()
  const rows = db
    .select()
    .from(templateThread)
    .where(
      and(
        eq(templateThread.templateId, templateId),
        eq(templateThread.side, 'taker'),
        gt(templateThread.id, Math.max(since, giver?.id ?? 0)),
      ),
    )
    .orderBy(asc(templateThread.id))
    .all()
  const newest = new Map(rows.map((r) => [r.userId, r]))
  return [...newest.values()].sort((a, b) => a.id - b.id)
}

/**
 * The change ended: every open row closes, as `accepted` for the ids given (the number the
 * template was agreed at) and `closed` for the rest. Returns the ids of each kind, ascending.
 */
export function closeThread(
  tx: Tx,
  templateId: number,
  accepted: readonly number[],
  now: Date,
): { accepted: number[]; closed: number[] } {
  const at = toIsoUtc(now)
  const result = { accepted: [] as number[], closed: [] as number[] }
  for (const r of openRows(tx, templateId)) {
    const closedAs = accepted.includes(r.id) ? 'accepted' : 'closed'
    tx.update(templateThread)
      .set({ closedAt: at, closedAs })
      .where(eq(templateThread.id, r.id))
      .run()
    result[closedAs].push(r.id)
  }
  return result
}

/** Every row of the template's thread, oldest first. */
export function threadOf(db: Db | Tx, templateId: number): TemplateThreadRow[] {
  return db
    .select()
    .from(templateThread)
    .where(eq(templateThread.templateId, templateId))
    .orderBy(asc(templateThread.id))
    .all()
}
