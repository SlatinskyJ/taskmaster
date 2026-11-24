import { eq } from 'drizzle-orm'
import type { DisputeKind, DisputeTarget, Level } from '~/domain'
import { effectiveSettlement, periodEnd } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { latestCorrection, toCorrection } from '~/server/corrections/read'
import { periods, pointAdjustments, settlements, tasks, templates } from '~/server/db/schema'
import { toPeriod } from '~/server/periods'
import { rejectionById } from '~/server/tasks/rejections'

// The record a dispute names (keys: ./README.md), read with the state that decides whether it
// is locked (spec §5.11), the numbers the audit entry keeps, and whose item it is.

export interface DisputeItem {
  kind: DisputeKind
  id: number
}

/**
 * The item's numbers when disputed (`dispute.opened` keeps them): a score, a settlement as it
 * stands now (its latest correction, #48), or an adjustment's points.
 */
export type DisputeValue =
  { score: number } | { level: Level; deducted: number } | { points: number }

/** What the Rozporováno list needs: a title, whose item it is, and a settlement's week. */
export interface ItemAbout {
  /** The task or template title, an adjustment's reason; '' for a settlement. */
  title: string
  /** The taker whose completion, rejection, settlement or adjustment it is; null for a score. */
  takerId: number | null
  /** A settlement's week (UTC ISO); null otherwise. */
  week: { startsAt: string; endsAt: string } | null
}

export interface LoadedTarget {
  target: DisputeTarget
  value: DisputeValue
  about: ItemAbout
}

export function loadTarget(db: Db | Tx, item: DisputeItem): LoadedTarget | null {
  switch (item.kind) {
    case 'task_score':
    case 'completion': {
      const t = db.select().from(tasks).where(eq(tasks.id, item.id)).get()
      if (!t) return null
      const value = { score: t.score }
      if (item.kind === 'task_score') {
        // Locked once agreed, whatever happened after (a cancelled agreed task stays locked).
        // A recurring copy's score is its template's: disputed there, never here (Jakub
        // 2026-11-22), so it never counts as agreed.
        const agreed = t.agreedAt !== null && t.templateId === null
        return {
          target: { kind: 'task_score', id: t.id, agreement: agreed ? 'open' : 'proposed' },
          value,
          about: { title: t.title, takerId: null, week: null },
        }
      }
      const outcome = t.status === 'confirmed' ? 'confirmed' : 'pending'
      return {
        target: { kind: 'completion', id: t.id, outcome },
        value,
        about: { title: t.title, takerId: t.earnerId, week: null },
      }
    }
    case 'template_score': {
      const t = db.select().from(templates).where(eq(templates.id, item.id)).get()
      if (!t) return null
      return {
        target: {
          kind: 'template_score',
          id: t.id,
          agreement: t.status === 'active' ? 'agreed' : 'proposed',
        },
        value: { score: t.score },
        about: { title: t.title, takerId: null, week: null },
      }
    }
    case 'rejection': {
      const r = rejectionById(db, item.id)
      if (!r) return null
      return {
        target: { kind: 'rejection', id: r.entryId },
        value: { score: r.score },
        about: { title: r.title, takerId: r.earnerId, week: null },
      }
    }
    case 'settlement': {
      const s = db.select().from(settlements).where(eq(settlements.id, item.id)).get()
      if (!s) return null
      const p = db.select().from(periods).where(eq(periods.id, s.periodId)).get()
      const period = p ? toPeriod(p) : null
      const latest = latestCorrection(db, s.id)
      const now = effectiveSettlement(s, latest ? toCorrection(s, latest) : null)
      return {
        target: { kind: 'settlement', id: s.id, periodId: s.periodId, takerId: s.takerId },
        value: { level: now.level, deducted: now.deducted },
        about: {
          title: '',
          takerId: s.takerId,
          week: period
            ? { startsAt: toIsoUtc(period.startsAt), endsAt: toIsoUtc(periodEnd(period)) }
            : null,
        },
      }
    }
    case 'adjustment': {
      const a = db.select().from(pointAdjustments).where(eq(pointAdjustments.id, item.id)).get()
      if (!a) return null
      return {
        target: { kind: 'adjustment', id: a.id },
        value: { points: a.points },
        about: { title: a.reason, takerId: a.takerId, week: null },
      }
    }
  }
}
