import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { dismissDispute, openDispute } from '~/domain'
import type { Dispute, DisputeError, DisputeRef, DisputeTarget, Result } from '~/domain'
import { fail, ok } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { disputes } from '~/server/db/schema'
import type { DisputeRow } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import { loadTarget } from './targets'
import type { DisputeItem, DisputeValue } from './targets'

// Opening (#46) and dismissing (#47) a dispute (spec §5.11), and the marks screens show on
// items. The rules are the domain's `openDispute` and `dismissDispute`; this module loads the
// record, runs the rule and writes the row with its audit entry in one transaction. Correcting
// (#48) is in `~/server/corrections`.

/**
 * What the dispute store refuses with: a domain refusal, an unknown item or dispute, or
 * (closing only) an item whose value changed since the admin saw it.
 */
export type DisputeServerError = DisputeError | 'not_found' | 'value_changed'
export type OpenDisputeError = Exclude<DisputeServerError, 'value_changed'>

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
    const ref = refOf(loaded.target)
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

/** The domain's name for a disputed record. */
export function refOf(t: DisputeTarget): DisputeRef {
  return t.kind === 'settlement'
    ? { kind: 'settlement', id: t.id, periodId: t.periodId, takerId: t.takerId }
    : { kind: t.kind, id: t.id }
}

/** A value with only its own fields, so two reads compare equal whatever else they carry. */
export const plain = (v: DisputeValue | null) =>
  v === null
    ? null
    : 'score' in v
      ? { score: v.score }
      : 'points' in v
        ? { points: v.points }
        : { level: v.level, deducted: v.deducted }

/** Whether the item's value moved since the admin saw it (dismiss #47, correct #48). */
export function valueMoved(seen: DisputeValue | null, now: DisputeValue | null): boolean {
  return JSON.stringify(plain(seen)) !== JSON.stringify(plain(now))
}

/**
 * The admin keeps a disputed item as it is, with a note (stored trimmed). `seen` is the item's
 * value the admin's list showed: when it changed since (a score change agreed meanwhile), the
 * dismissal is refused, so a note never lands on a value nobody reviewed.
 */
export function dismissDisputeIn(
  db: Db | Tx,
  adminId: number,
  disputeId: number,
  seen: DisputeValue | null,
  note: string,
  now: Date,
): Result<{ id: number }, DisputeServerError> {
  return db.transaction((tx): Result<{ id: number }, DisputeServerError> => {
    const row = tx.select().from(disputes).where(eq(disputes.id, disputeId)).get()
    // Disputed records are never deleted, so a missing target means a missing dispute too.
    const loaded = row ? loadTarget(tx, { kind: row.itemKind, id: row.itemId }) : null
    if (!row || !loaded) return fail('not_found')
    const base = { item: refOf(loaded.target), openedBy: row.openedBy, reason: row.reason }
    // A closed row only needs to read as not open; the domain refuses it before its fields.
    const dispute: Dispute =
      row.status === 'open'
        ? { ...base, status: 'open' }
        : { ...base, status: 'dismissed', resolvedBy: row.resolvedBy ?? 0, note: row.note ?? '' }
    const kept = dismissDispute(dispute, listPeople(tx), adminId, note)
    if (!kept.ok) return kept
    if (kept.value.status !== 'dismissed') throw new Error('dismissDispute: not dismissed')
    const value = plain(loaded.value)
    if (valueMoved(seen, value)) return fail('value_changed')
    const text = kept.value.note
    const changed = tx
      .update(disputes)
      .set({ status: 'dismissed', resolvedBy: adminId, resolvedAt: toIsoUtc(now), note: text })
      .where(and(eq(disputes.id, disputeId), eq(disputes.status, 'open')))
      .run()
    if (changed.changes !== 1) return fail('not_open')
    writeAudit(tx, {
      actor: { kind: 'user', userId: adminId },
      action: 'dispute.dismissed',
      entityType: 'dispute',
      entityId: disputeId,
      before: { status: 'open' },
      after: { status: 'dismissed', note: text, value },
      at: now,
    })
    return ok({ id: disputeId })
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
