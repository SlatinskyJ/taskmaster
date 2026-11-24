import { dayLabel, dayMonth, levelLabel, weekLabel } from '~/components/period/periodView'
import { cs } from '~/lib/strings'
import type { ItemStateKey } from '~/lib/strings'
import type { HistoryRecord, WeekAdjustment, WeekItem } from '~/server/settlement/functions'

// Labels for Týden (#45).

const CHIP: Record<WeekItem['status'], ItemStateKey> = {
  confirmed: 'confirmed',
  done_unconfirmed: 'pending',
  rejected: 'rejected',
}

/** The state chip of a week item. */
export function itemChip(item: WeekItem): ItemStateKey {
  return CHIP[item.status]
}

/** "st 25. 11.": the day it was done (a rejection: the day it was rejected). */
export function itemMeta(item: WeekItem): string {
  return dayLabel(item.at)
}

/** "Celkem 108 · odečteno 100 · převod 8". */
export function historyLine(r: HistoryRecord): string {
  const w = cs.week
  return `${w.total} ${String(r.totalBefore)} · ${w.deducted} ${String(r.deducted)} · ${w.carry} ${String(r.carryOver)}`
}

/** An adjustment row on Týden (#48): its name, chip, meta line and signed points. */
export function adjustmentRow(a: WeekAdjustment): {
  name: string
  state: ItemStateKey
  stateLabel: string
  meta: string
  points: string
} {
  const w = cs.week
  return {
    name: a.fromWeek ? w.correctionRow : w.adjustment,
    state: a.waiting ? 'pending' : 'confirmed',
    stateLabel: a.waiting ? w.waiting : w.counted,
    meta: a.fromWeek
      ? `${w.fromWeek(weekLabel(a.fromWeek.startsAt, a.fromWeek.endsAt))} · ${dayLabel(a.at)}`
      : dayLabel(a.at),
    points: w.adjustmentPoints(a.points),
  }
}

/**
 * Under a corrected settled week: the corrected and original levels, the net change on his
 * total (settled deduction − corrected), the latest correction's date and reason; else null.
 */
export function correctionLine(r: HistoryRecord): string | null {
  const c = r.correction
  if (!c) return null
  return cs.week.correctedLine(
    levelLabel(c.level),
    levelLabel(r.level),
    r.deducted - c.deducted,
    dayMonth(c.at),
    c.reason,
  )
}
