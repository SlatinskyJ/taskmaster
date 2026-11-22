import { and, eq } from 'drizzle-orm'
import type { DisputeKind, DisputeTarget, Level } from '~/domain'
import { periodEnd } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { auditLog, periods, settlements, tasks, templates } from '~/server/db/schema'
import { toPeriod } from '~/server/periods'
import type { TaskAuditView } from '~/server/tasks/lifecycle'

// The record a dispute names (keys: ./README.md), read with the state that decides whether it
// is locked (spec §5.11), the numbers the audit entry keeps, and whose item it is.

export interface DisputeItem {
  kind: DisputeKind
  id: number
}

/** The item's numbers when disputed (`dispute.opened` keeps them, plan Decision 8). */
export type DisputeValue = { score: number } | { level: Level; deducted: number }

/** What the Rozporováno list needs: a title, whose item it is, and a settlement's week. */
export interface ItemAbout {
  /** The task or template title; '' for a settlement. */
  title: string
  /** The taker whose completion, rejection or settlement it is; null for a score. */
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
        return {
          target: { kind: 'task_score', id: t.id, agreement: t.agreedAt ? 'open' : 'proposed' },
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
      const e = db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.id, item.id), eq(auditLog.action, 'task.rejected')))
        .get()
      if (!e?.before) return null
      const before = JSON.parse(e.before) as TaskAuditView
      const t = db
        .select({ title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, Number(e.entityId)))
        .get()
      return {
        target: { kind: 'rejection', id: e.id },
        value: { score: before.score },
        about: { title: t?.title ?? '', takerId: before.earnerId, week: null },
      }
    }
    case 'settlement': {
      const s = db.select().from(settlements).where(eq(settlements.id, item.id)).get()
      if (!s) return null
      const p = db.select().from(periods).where(eq(periods.id, s.periodId)).get()
      const period = p ? toPeriod(p) : null
      return {
        target: { kind: 'settlement', id: s.id, periodId: s.periodId, takerId: s.takerId },
        value: { level: s.level, deducted: s.deducted },
        about: {
          title: '',
          takerId: s.takerId,
          week: period
            ? { startsAt: toIsoUtc(period.startsAt), endsAt: toIsoUtc(periodEnd(period)) }
            : null,
        },
      }
    }
    case 'adjustment':
      // No adjustments table before #48.
      return null
  }
}
