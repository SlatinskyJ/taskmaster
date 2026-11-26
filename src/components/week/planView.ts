import { dayMonth } from '~/components/period/periodView'
import { dayLabel } from '~/components/tasks/taskView'
import { formatPragueTime } from '~/lib/formatDate'
import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import { describeDays } from '~/lib/templateText'
import type { PlanCopy, PlanRow, WeekPlan } from '~/server/instances/functions'

// The plan table's cell rules (#258, spec §5.12): what a cell shows and what a tap does. Pure,
// so the table component stays a drawing and #259's meeting step can reuse both.

export type CellKind =
  | { kind: 'blank' }
  | { kind: 'free'; copy: PlanCopy }
  | { kind: 'reserved'; copy: PlanCopy; mine: boolean }
  | { kind: 'pending'; copy: PlanCopy }
  | { kind: 'confirmed'; copy: PlanCopy }
  | { kind: 'expired'; copy: PlanCopy }
  | { kind: 'cancelled'; copy: PlanCopy }
  | { kind: 'count'; copies: PlanCopy[] }

export interface Viewer {
  id: number
  role: 'taker' | 'giver'
}
/** What a tap does: reserve, the Uvolnit sheet, release (list rows only), the list sheet, or the task page. */
export type TapAction = 'reserve' | 'releaseSheet' | 'release' | 'list' | 'open'

const isMine = (copy: PlanCopy, viewer: Viewer) =>
  viewer.role === 'taker' && copy.status === 'reserved' && copy.person?.id === viewer.id

export function cellKind(copies: PlanCopy[], viewer: Viewer): CellKind {
  const [copy, ...more] = copies
  if (!copy) return { kind: 'blank' }
  if (more.length > 0) return { kind: 'count', copies }
  switch (copy.status) {
    case 'open':
      return { kind: 'free', copy }
    case 'reserved':
      return { kind: 'reserved', copy, mine: isMine(copy, viewer) }
    case 'done_unconfirmed':
      return { kind: 'pending', copy }
    case 'confirmed':
      return { kind: 'confirmed', copy }
    case 'expired':
      return { kind: 'expired', copy }
    case 'cancelled':
      return { kind: 'cancelled', copy }
  }
}

/** null for a blank cell (nothing to tap). A parent's tap never reserves: it opens the page. */
export function tapAction(cell: CellKind, viewer: Viewer): TapAction | null {
  switch (cell.kind) {
    case 'blank':
      return null
    case 'count':
      return 'list'
    case 'free':
      return viewer.role === 'taker' ? 'reserve' : 'open'
    case 'reserved':
      return cell.mine ? 'releaseSheet' : 'open'
    default:
      return 'open'
  }
}

/** A row of the several-copies sheet: a brother's free row reserves, his own releases. */
export function listRowAction(copy: PlanCopy, viewer: Viewer): 'reserve' | 'release' | 'open' {
  if (viewer.role !== 'taker') return 'open'
  if (copy.status === 'open') return 'reserve'
  return isMine(copy, viewer) ? 'release' : 'open'
}

/** Days before today (both are UTC ISO starts of a Prague day). */
export function isPast(day: string, today: string): boolean {
  return day < today
}

/** Open copies from today on: the number on Týden's card. */
export function freeCount(plan: WeekPlan): number {
  let n = 0
  plan.days.forEach((day, i) => {
    if (isPast(day, plan.today)) return
    for (const row of plan.rows) n += (row.cells[i] ?? []).filter((c) => c.status === 'open').length
  })
  return n
}

/** `{ weekday: 'St', date: '2. 12.' }`. */
export function dayHeader(day: string): { weekday: string; date: string } {
  return { weekday: dayLabel(day), date: dayMonth(day) }
}

/** The line under a chore's name: its days only ("každý den", "Út, Pá"). */
export function rowMeta(row: PlanRow): string {
  return describeDays(row.scheduleDays)
}

function stateLabel(cell: CellKind, viewer: Viewer): string {
  const a = cs.plan.aria
  const name = (c: PlanCopy) => c.person?.name ?? ''
  switch (cell.kind) {
    case 'blank':
      return ''
    case 'free':
      return viewer.role === 'taker' ? a.free : a.freeGiver
    case 'reserved':
      return cell.mine ? a.mine : a.reserved(name(cell.copy))
    case 'pending':
      return a.pending(name(cell.copy))
    case 'confirmed':
      return a.confirmed(name(cell.copy))
    case 'expired':
      return a.expired
    case 'cancelled':
      return a.cancelled
    case 'count':
      return a.count(cell.copies.length)
  }
}

/** "Prostřít stůl k večeři, St: volné, rezervovat": the full title, always. */
export function cellLabel(title: string, day: string, cell: CellKind, viewer: Viewer): string {
  return `${title}, ${dayHeader(day).weekday}: ${stateLabel(cell, viewer)}`
}

function copyState(copy: PlanCopy, viewer: Viewer): string {
  switch (copy.status) {
    case 'open':
      return cs.state.open
    case 'reserved':
      return isMine(copy, viewer) ? cs.plan.byYou : cs.plan.reservedBy(copy.person?.name ?? '')
    case 'done_unconfirmed':
      return cs.state.pending
    case 'confirmed':
      return cs.state.confirmed
    case 'expired':
      return cs.state.expired
    case 'cancelled':
      return cs.state.cancelled
  }
}

/** A list row: "Navíc 14:20 · Volné", and its button text (null: the row opens the page). */
export function listRowLabel(
  copy: PlanCopy,
  viewer: Viewer,
): { what: string; action: string | null } {
  const origin =
    copy.origin === 'scheduled'
      ? cs.plan.bySchedule
      : cs.plan.extra(formatPragueTime(copy.createdAt))
  const act = listRowAction(copy, viewer)
  return {
    what: `${origin} · ${copyState(copy, viewer)}`,
    action: act === 'reserve' ? cs.work.reserve : act === 'release' ? cs.work.release : null,
  }
}

/** A refused reserve: `wrong_state` from a free cell means a brother took it first (first tap wins). */
export function reserveErrorMessage(error: string): string {
  return error === 'wrong_state' ? cs.tasks.errors.reservedByOther : taskErrorMessage(error)
}
