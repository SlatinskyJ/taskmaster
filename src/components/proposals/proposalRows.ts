import { dayTime, pad } from '~/components/period/periodView'
import type { PeriodDefaults } from '~/domain'
import { parseIsoUtc } from '~/domain/dates'
import { cs } from '~/lib/strings'
import type { ProposalView, SpanView } from '~/server/periods/functions'
import { lengthInDays } from './proposalView'

// What a proposal card lists: each value old → new (framework-free, tested without a DOM).

const t = cs.proposals
const weekdayNames = cs.admin.defaults.weekdayNames

/** One value of a proposal: the old one struck through next to the new one, or once. */
export interface ChangeRow {
  label: string
  old: string
  now: string
}

/** Next week's proposal against the default week the server would start (`defaultNext`). */
export function periodRows(
  p: ProposalView<{ cutoffAt: string; levels: { lower: number; upper: number } }>,
  defaultNext: SpanView,
): ChangeRow[] {
  const start = parseIsoUtc(defaultNext.startsAt)
  const s = p.settings
  return [
    { label: t.end, old: dayTime(defaultNext.cutoffAt), now: dayTime(s.cutoffAt) },
    {
      label: t.length,
      old: t.days(lengthInDays(start, parseIsoUtc(defaultNext.cutoffAt))),
      now: t.days(lengthInDays(start, parseIsoUtc(s.cutoffAt))),
    },
    { label: t.lower, old: String(defaultNext.levels.lower), now: String(s.levels.lower) },
    { label: t.upper, old: String(defaultNext.levels.upper), now: String(s.levels.upper) },
  ]
}

/** "neděle 23:59": a default week's end weekday and time. */
export const weekdayTime = (d: PeriodDefaults) =>
  t.weekdayTime(weekdayNames[d.cutoff.weekday], `${pad(d.cutoff.hour)}:${pad(d.cutoff.minute)}`)

/** A default-week proposal against the stored default week. */
export function defaultsRows(
  p: ProposalView<PeriodDefaults>,
  current: PeriodDefaults,
): ChangeRow[] {
  const s = p.settings
  return [
    { label: t.length, old: t.days(current.lengthDays), now: t.days(s.lengthDays) },
    { label: t.end, old: weekdayTime(current), now: weekdayTime(s) },
    { label: t.lower, old: String(current.levels.lower), now: String(s.levels.lower) },
    { label: t.upper, old: String(current.levels.upper), now: String(s.levels.upper) },
  ]
}

/** "Nyní: 7 dní · konec neděle 23:59 · spodní hranice 50, horní 100" over the Výchozí týden form. */
export const defaultsNowLine = (d: PeriodDefaults) =>
  t.nowLine(t.days(d.lengthDays), weekdayTime(d), d.levels.lower, d.levels.upper)
