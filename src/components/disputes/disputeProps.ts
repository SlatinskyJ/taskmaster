import { dayMonth, levelLabel, weekLabel } from '~/components/period/periodView'
import { historyLine } from '~/components/week/weekView'
import { cs, formatPoints } from '~/lib/strings'
import type { AdminDisputeEntry, OpenableKind } from '~/server/disputes/functions'
import type { HistoryRecord, HistoryWeek, WeekItem } from '~/server/settlement/functions'
import type { TaskView } from '~/server/tasks/functions'
import type { TemplateView } from '~/server/templates/functions'

// What each Rozporovat names (#46, spec §5.11) and what its drawer shows. One place, so a test
// pins the exact item each screen sends.

export interface DisputeProps {
  item: { kind: OpenableKind; id: number }
  what: string
  /** The item and its value now; the boy's name first in a giver's view. */
  value: string
  /** The item's name, for the button's accessible name. */
  name: string
}

const line = (...parts: (string | null)[]) => parts.filter((p) => p !== null).join(' · ')

/** A confirmed or rejected Týden item; null for one still waiting (not locked yet). */
export function weekItemDispute(item: WeekItem, takerName: string | null): DisputeProps | null {
  if (!item.dispute) return null
  const { kind, id } = item.dispute.item
  return {
    item: { kind, id },
    what: cs.disputes.what[kind],
    value: line(takerName, item.title, formatPoints(item.score)),
    name: item.title,
  }
}

/** A settled week's record for one boy. */
export function recordDispute(week: HistoryWeek, r: HistoryRecord, named: boolean): DisputeProps {
  const label = weekLabel(week.startsAt, week.endsAt)
  return {
    item: { kind: 'settlement', id: r.id },
    what: cs.disputes.what.settlement,
    value: line(named ? r.name : null, label, historyLine(r)),
    name: label,
  }
}

/**
 * Not agreed: still proposed, or cancelled or expired from there. A cancelled agreed task is
 * locked too, but the page cannot tell it apart, so it offers none.
 */
const NOT_AGREED: readonly TaskView['status'][] = ['proposed', 'cancelled', 'expired']

/** The task page: a one-time task's score once agreed, and any completion once confirmed. */
export function taskDisputes(task: TaskView, named: boolean): DisputeProps[] {
  if (NOT_AGREED.includes(task.status)) return []
  const value = line(task.title, formatPoints(task.score))
  const out: DisputeProps[] = []
  // A recurring copy's score is its template's: disputed on the template page (Jakub 2026-11-22).
  if (task.origin === 'one_time') {
    out.push({
      item: { kind: 'task_score', id: task.id },
      what: cs.disputes.what.task_score,
      value,
      name: task.title,
    })
  }
  if (task.status === 'confirmed') {
    const earner = named && task.earnerId !== null ? (task.completedBy?.name ?? null) : null
    out.push({
      item: { kind: 'completion', id: task.id },
      what: cs.disputes.what.completion,
      value: line(earner, value),
      name: task.title,
    })
  }
  return out
}

/** A recurring template's score, once active. */
export function templateDispute(t: TemplateView): DisputeProps | null {
  if (t.status !== 'active') return null
  return {
    item: { kind: 'template_score', id: t.id },
    what: cs.disputes.what.template_score,
    value: line(t.title, formatPoints(t.score)),
    name: t.title,
  }
}

export interface AdminDisputeLines {
  /** What is disputed, with whose it is. */
  what: string
  /** The item and its value now. */
  value: string
  /** Who opened it, and the Prague date. */
  opened: string
  reason: string
  /** The item's name, for the Ponechat button's accessible name. */
  name: string
}

/** A row of the admin's Sporné on Správa (#47). */
export function adminDisputeLines(e: AdminDisputeEntry): AdminDisputeLines {
  const name = e.week ? weekLabel(e.week.startsAt, e.week.endsAt) : e.title
  const v = e.value
  const amount =
    v === null
      ? null
      : 'score' in v
        ? formatPoints(v.score)
        : 'points' in v
          ? cs.disputes.adjustmentValue(v.points)
          : line(levelLabel(v.level), `${cs.week.deducted} ${String(v.deducted)}`)
  return {
    what: line(cs.disputes.what[e.item.kind], e.takerName),
    value: line(name, amount),
    opened: line(cs.admin.disputes.openedBy(e.openedByName), dayMonth(e.openedAt)),
    reason: e.reason,
    name,
  }
}
