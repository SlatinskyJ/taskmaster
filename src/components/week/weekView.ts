import { dayLabel } from '~/components/period/periodView'
import { cs } from '~/lib/strings'
import type { ItemStateKey } from '~/lib/strings'
import type { HistoryRecord, WeekItem } from '~/server/settlement/functions'

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

/** "st 25. 11.", and for a rejection with a reason "st 25. 11. · Nedodělané". */
export function itemMeta(item: WeekItem): string {
  const day = dayLabel(item.at)
  return item.reason ? `${day} · ${item.reason}` : day
}

/** "Celkem 108 · odečteno 100 · převod 8". */
export function historyLine(r: HistoryRecord): string {
  const w = cs.week
  return `${w.total} ${String(r.totalBefore)} · ${w.deducted} ${String(r.deducted)} · ${w.carry} ${String(r.carryOver)}`
}
