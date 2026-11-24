import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { openDispute } from '~/domain'
import type { Dispute, DisputeError, DisputeRef, Result } from '~/domain'
import { fail, ok } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { disputes } from '~/server/db/schema'
import type { DisputeRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import { loadTarget } from './targets'
import type { DisputeItem } from './targets'

// Opening a dispute (spec §5.11, #46) and the marks screens show on items. The rule is the
// domain's `openDispute`; this module loads the record, runs it and writes the row with its
// audit entry in one transaction. Closing (dismiss #47, correct #48) comes later.

export type OpenDisputeError = DisputeError | 'not_found'

/** What an item shows: an open dispute, or the newest closed one's outcome with the note. */
export type DisputeMark = { status: 'open' } | { status: 'dismissed' | 'corrected'; note: string }

export const markKey = (item: DisputeItem) => `${item.kind}:${String(item.id)}`

type NewOpen = Pick<DisputeRow, 'itemKind' | 'itemId' | 'openedBy' | 'reason' | 'openedAt'>

/**
 * Inserts an open dispute. The partial unique index refuses a second open one on the item
 * (two taps at once): SQLite names the columns in that error, not the index.
 */
export function insertOpen(tx: Tx, row: NewOpen): Result<{ id: number }, 'dispute_open'> {
  try {
    return ok(
      tx
        .insert(disputes)
        .values({ ...row, status: 'open' })
        .returning({ id: disputes.id })
        .get(),
    )
  } catch (err) {
    const e = err as {
      code?: unknown
      message?: unknown
      cause?: { code?: unknown; message?: unknown }
    }
    const code = e.cause?.code ?? e.code
    const message = String(e.cause?.message ?? e.message)
    if (
      code === 'SQLITE_CONSTRAINT_UNIQUE' &&
      message.includes('disputes.item_kind, disputes.item_id')
    ) {
      return fail('dispute_open')
    }
    throw err
  }
}

function openOn(tx: Tx, item: DisputeItem) {
  return tx
    .select()
    .from(disputes)
    .where(
      and(
        eq(disputes.itemKind, item.kind),
        eq(disputes.itemId, item.id),
        eq(disputes.status, 'open'),
      ),
    )
    .all()
}

/** A taker or giver disputes a locked item with a reason (stored trimmed). */
export function openDisputeIn(
  db: Db | Tx,
  userId: number,
  item: DisputeItem,
  reason: string,
  now: Date,
): Result<{ id: number }, OpenDisputeError> {
  return db.transaction((tx): Result<{ id: number }, OpenDisputeError> => {
    const loaded = loadTarget(tx, item)
    const people = listPeople(tx)
    if (!loaded) {
      // The admin is told the same as for a real item, so a wrong actor learns nothing.
      const opener = people.find((p) => p.id === userId)
      return fail(opener && opener.role !== 'admin' ? 'not_found' : 'not_a_party')
    }
    const t = loaded.target
    const ref: DisputeRef =
      t.kind === 'settlement'
        ? { kind: 'settlement', id: t.id, periodId: t.periodId, takerId: t.takerId }
        : { kind: t.kind, id: t.id }
    const existing = openOn(tx, item).map((d): Dispute => ({
      item: ref,
      openedBy: d.openedBy,
      reason: d.reason,
      status: 'open',
    }))
    const opened = openDispute(people, userId, loaded.target, reason, existing)
    if (!opened.ok) return opened
    const row = {
      itemKind: item.kind,
      itemId: item.id,
      openedBy: userId,
      reason: opened.value.reason,
      openedAt: toIsoUtc(now),
    }
    const inserted = insertOpen(tx, row)
    if (!inserted.ok) return inserted
    writeAudit(tx, {
      actor: { kind: 'user', userId },
      action: 'dispute.opened',
      entityType: 'dispute',
      entityId: inserted.value.id,
      after: { itemKind: item.kind, itemId: item.id, reason: row.reason, value: loaded.value },
      at: now,
    })
    return ok(inserted.value)
  })
}

/** Per item: its open dispute, else its newest closed one. Items with none are missing. */
export function disputeMarks(db: Db | Tx, items: readonly DisputeItem[]): Map<string, DisputeMark> {
  const out = new Map<string, DisputeMark>()
  if (items.length === 0) return out
  const byKind = new Map<DisputeItem['kind'], number[]>()
  for (const i of items) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i.id])
  const rows = db
    .select()
    .from(disputes)
    .where(
      or(
        ...[...byKind].map(([kind, ids]) =>
          and(eq(disputes.itemKind, kind), inArray(disputes.itemId, ids)),
        ),
      ),
    )
    .orderBy(desc(disputes.resolvedAt), desc(disputes.id))
    .all()
  for (const r of rows) {
    const key = markKey({ kind: r.itemKind, id: r.itemId })
    if (r.status === 'open') out.set(key, { status: 'open' })
    else if (!out.has(key)) out.set(key, toMark(r))
  }
  return out
}

/** A row's mark: open, or its outcome with the admin's note. */
export function toMark(r: DisputeRow): DisputeMark {
  return r.status === 'open' ? { status: 'open' } : { status: r.status, note: r.note ?? '' }
}
