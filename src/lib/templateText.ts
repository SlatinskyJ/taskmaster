import type { TemplateView } from '~/server/templates/functions'
import { cs } from './strings'

// One-line Czech summary of a template's schedule and deadline (spec §5.3), for rows on Úkoly
// and in "Čeká na tebe": "Út, Pá v 18:00 · do dalšího dne 7:00 (+2 h)".

const t = cs.templates

/** Monday first, Sunday last, as Czech calendars show a week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

/** `"07:05"` → `"7:05"`. */
function clock(hhmm: string): string {
  return hhmm.replace(/^0(\d)/, '$1')
}

export function describeTemplate({
  schedule,
  deadline,
}: Pick<TemplateView, 'schedule' | 'deadline'>): string {
  let text: string = t.onDemand
  if (schedule) {
    const days = WEEK_ORDER.filter((d) => schedule.days.includes(d)).map((d) => t.days[d])
    text = days.join(', ')
    if (schedule.time) text += ` ${t.summary.at} ${clock(schedule.time)}`
  }
  if (deadline) {
    const due = clock(deadline.due)
    let part: string
    if (deadline.dayOffset === 0) part = `${t.summary.due} ${due}`
    else if (deadline.dayOffset === 1) part = `${t.summary.due} ${t.summary.nextDay} ${due}`
    else part = `${t.summary.due} ${due} ${t.dayOffsets[deadline.dayOffset] ?? ''}`
    if (deadline.graceMinutes > 0) part += ` (+${t.hours(deadline.graceMinutes / 60)})`
    text += ` · ${part}`
  }
  return text
}

/** Summary + approval flag, and for a proposed template who agreed so far. */
export function templateDetail(
  view: Pick<TemplateView, 'schedule' | 'deadline' | 'approvalRequired' | 'approvedBy' | 'status'>,
): string {
  const parts = [describeTemplate(view), view.approvalRequired ? t.approvalOn : t.approvalOff]
  if (view.status === 'proposed' && view.approvedBy.length > 0) {
    parts.push(`${t.agreedBy}: ${view.approvedBy.join(', ')}`)
  }
  return parts.join(' · ')
}
