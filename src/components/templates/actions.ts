import { MAX_GRACE_MINUTES } from '~/domain'
import type { ClockTime } from '~/domain'
import type { Weekday } from '~/domain/dates'
import { cs } from '~/lib/strings'
import { taskErrorMessage } from '~/lib/taskErrors'
import { createTaskFn } from '~/server/tasks/functions'
import { approveTemplateScoreFn, createTemplateFn } from '~/server/templates/functions'
import type { NewTemplate, TemplateView } from '~/server/templates/functions'

// What the Nový úkol form and the template "Souhlasím" send, as plain functions. The server
// function is a parameter (default: the real one), so tests check which call gets which data
// without a DOM.

/** The recurring half of the Nový úkol form, as the inputs hold it. */
export interface RecurringValue {
  days: Weekday[]
  withTime: boolean
  /** `HH:MM` from `<input type="time">`. */
  time: string
  hasDeadline: boolean
  dayOffset: number
  dueTime: string
  graceHours: number
}

export const DEFAULT_RECURRING: RecurringValue = {
  days: [],
  withTime: true,
  time: '18:00',
  hasDeadline: false,
  dayOffset: 1,
  dueTime: '07:00',
  graceHours: 2,
}

export const MAX_GRACE_HOURS = MAX_GRACE_MINUTES / 60

/** `"18:30"` → `{ hour: 18, minute: 30 }`. A malformed value gives NaN; the server refuses it. */
function parseClock(hhmm: string): ClockTime {
  const [hour = Number.NaN, minute = Number.NaN] = hhmm.split(':').map(Number)
  return { hour, minute }
}

/** The form's recurring inputs as the server's schedule and deadline rule. */
export function toDefinition(v: RecurringValue): Pick<NewTemplate, 'schedule' | 'deadline'> {
  return {
    schedule:
      v.days.length === 0 ? null : { days: v.days, time: v.withTime ? parseClock(v.time) : null },
    deadline: v.hasDeadline
      ? { dayOffset: v.dayOffset, due: parseClock(v.dueTime), graceMinutes: v.graceHours * 60 }
      : null,
  }
}

export type ItemKind = 'one_time' | 'recurring'

export interface NewItemForm {
  title: string
  score: number
  approvalRequired: boolean
  recurring: RecurringValue
}

type ActionResult = { ok: true; id: number } | { ok: false; error: string }

/** Creates a one-time task or a template, by the form's switch. */
export async function submitNewItem(
  kind: ItemKind,
  form: NewItemForm,
  fns: {
    createTask: (input: {
      data: { title: string; score: number; approvalRequired: boolean }
    }) => Promise<ActionResult>
    createTemplate: (input: { data: NewTemplate }) => Promise<ActionResult>
  } = { createTask: createTaskFn, createTemplate: createTemplateFn },
): Promise<ActionResult> {
  const { title, score, approvalRequired } = form
  if (kind === 'one_time') return fns.createTask({ data: { title, score, approvalRequired } })
  return fns.createTemplate({
    data: { title, score, approvalRequired, ...toDefinition(form.recurring) },
  })
}

/** "Souhlasím" on a proposed template: approves the score the person sees. */
export function approveTemplate(
  t: Pick<TemplateView, 'id' | 'score'>,
  fn: (input: {
    data: { templateId: number; score: number }
  }) => Promise<ActionResult> = approveTemplateScoreFn,
): Promise<ActionResult> {
  return fn({ data: { templateId: t.id, score: t.score } })
}

/** The toast after an approval, or after the call threw (network). */
export function approveOutcome(result: { ok: true } | { ok: false; error: string } | 'threw'): {
  toast: 'success' | 'error'
  message: string
} {
  if (result === 'threw') return { toast: 'error', message: cs.login.failed }
  if (result.ok) return { toast: 'success', message: cs.tasks.approved }
  return { toast: 'error', message: taskErrorMessage(result.error) }
}
