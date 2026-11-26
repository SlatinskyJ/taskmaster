import type { TemplateAgreement } from './agreement'
import type { Item } from './lifecycle'
import type { Person, PersonId } from './parties'
import { isActiveAs } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// A task's or a chore's description: its acceptance criteria (spec §4, §5.1, §5.2, §5.3).
//
// Any giver writes or changes it; a taker never does. While the task or chore is proposed the
// change applies at once. Once agreed it waits for a taker's OK: reserved → the reserving taker,
// open (a task) or agreed (a chore) → any one taker. One change waits at a time; a giver's new
// change replaces it, a taker's no closes it. Once completed the text is frozen. An instance's
// text is a copy of its chore's at creation and is never changed (ruling 4).

/** Up to 1000 characters (spec §4, Jakub 2026-11-24). */
export const DESCRIPTION_MAX = 1000

export type DescriptionError =
  | 'description_too_long'
  | 'not_a_giver'
  | 'not_a_taker'
  | 'not_involved'
  | 'description_frozen'
  | 'not_changeable'
  | 'same_description'

/** Who must OK a change now. `direct` = it applies at once. */
export type DescriptionRule =
  { kind: 'direct' } | { kind: 'any_taker' } | { kind: 'taker'; takerId: PersonId }

// C0 controls except TAB (U+0009) and LF (U+000A), DEL, and the bidi embeddings, overrides and
// isolates: text shown to children keeps no hidden characters (ruling 6).
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g

/**
 * The stored form of a description: line breaks as LF, hidden characters removed, the whole
 * text trimmed. Empty → `null` (no description). The limit counts the result.
 */
export function normaliseDescription(raw: string): Result<string | null, 'description_too_long'> {
  const text = raw.replace(/\r\n?/g, '\n').replace(HIDDEN, '').trim()
  if (text.length > DESCRIPTION_MAX) return fail('description_too_long')
  return ok(text === '' ? null : text)
}

/** Who must OK a change of a one-time task's description now, or why it can't change. */
export function taskDescriptionRule(item: Item): Result<DescriptionRule, DescriptionError> {
  if (item.origin !== 'one_time') return fail('not_changeable')
  switch (item.status) {
    case 'proposed':
      return ok({ kind: 'direct' })
    case 'open':
      return ok({ kind: 'any_taker' })
    case 'reserved':
      return ok({ kind: 'taker', takerId: item.reservation.takerId })
    default:
      return fail('description_frozen')
  }
}

/** Who must OK a change of a template's description now. */
export function templateDescriptionRule(status: TemplateAgreement['status']): DescriptionRule {
  return status === 'proposed' ? { kind: 'direct' } : { kind: 'any_taker' }
}

/**
 * A giver changes the text. `current` is the text in force; `pending` the waiting change's text
 * (`undefined` = none waits, `null` = a waiting removal); `next` the normalised new text.
 * Back to the text in force while a change waits withdraws that change (ruling 5).
 */
export function changeDescription(
  rule: DescriptionRule,
  current: string | null,
  pending: string | null | undefined,
  people: readonly Person[],
  giverId: PersonId,
  next: string | null,
): Result<'apply' | 'wait' | 'withdraw', DescriptionError> {
  if (!isActiveAs(people, giverId, 'giver')) return fail('not_a_giver')
  if (pending !== undefined && next === pending) return fail('same_description')
  if (next === current) return pending === undefined ? fail('same_description') : ok('withdraw')
  return ok(rule.kind === 'direct' ? 'apply' : 'wait')
}

/** A taker answers the waiting change (yes or no alike): may he? */
export function answerDescription(
  rule: DescriptionRule,
  people: readonly Person[],
  takerId: PersonId,
): Result<true, DescriptionError> {
  if (!isActiveAs(people, takerId, 'taker')) return fail('not_a_taker')
  if (rule.kind === 'direct') return fail('not_involved')
  if (rule.kind === 'taker' && rule.takerId !== takerId) return fail('not_involved')
  return ok(true)
}

/**
 * What a waiting change does once a lifecycle step moved the task (rulings 1–3): it stays on an
 * open or reserved task; it applies when the task is back to proposed (Jakub 2026-11-26: a
 * proposed task needs nobody's OK); it is discarded once the task is done or cancelled.
 */
export function waitingChangeAfter(item: Item): 'keep' | 'apply' | 'discard' {
  switch (item.status) {
    case 'open':
    case 'reserved':
      return 'keep'
    case 'proposed':
      return 'apply'
    default:
      return 'discard'
  }
}

/**
 * A taker's page showed `seen` while the text in force is `current` (ruling 8): stale if the two
 * differ after normalising. `undefined` = the page sent nothing, never stale; a `seen` too long to
 * be a description is stale.
 */
export function isStaleDescription(
  current: string | null,
  seen: string | null | undefined,
): boolean {
  if (seen === undefined) return false
  if (seen === null) return current !== null
  const text = normaliseDescription(seen)
  return !text.ok || text.value !== current
}
