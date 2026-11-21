import { and, asc, eq, isNull } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { templateThread } from '~/server/db/schema'
import type { TemplateThreadRow } from '~/server/db/schema'

// The score change thread of an agreed template (spec §5.1): giver-side offers and takers' bids.
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
