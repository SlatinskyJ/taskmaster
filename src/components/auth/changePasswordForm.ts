import { cs } from '~/lib/strings'
import { MAX_PASSWORD_LENGTH, MIN_USER_PASSWORD } from '~/lib/userLimits'
import type { ChangePasswordResult } from '~/server/users/functions'

// What the Změnit heslo sheet (#210) decides, without React: the checks before sending, the
// Czech text of each answer, and which field Return moves to. ChangePasswordForm only wires
// these to inputs, so they are tested here.

export interface ChangePasswordValues {
  current: string
  next: string
  again: string
  logOutOthers: boolean
}

export const EMPTY_PASSWORD_FORM: ChangePasswordValues = {
  current: '',
  next: '',
  again: '',
  logOutOthers: true,
}

/** A Czech error to show instead of sending, or null when the form may be sent. */
export function checkBeforeSending(v: ChangePasswordValues): string | null {
  if (v.next.length < MIN_USER_PASSWORD || v.next.length > MAX_PASSWORD_LENGTH) {
    return cs.profile.passwordErrors.tooShort(MIN_USER_PASSWORD)
  }
  if (v.next !== v.again) return cs.profile.passwordErrors.mismatch
  return null
}

type ServerError = Extract<ChangePasswordResult, { ok: false }>['error']

/** One text per server error: a new error code fails the typecheck until it has its text. */
export const SERVER_ERROR_TEXT: Record<ServerError, string> = {
  invalid_password: cs.profile.passwordErrors.tooShort(MIN_USER_PASSWORD),
  wrong_password: cs.profile.passwordErrors.wrong,
  rate_limited: cs.login.rateLimited,
  changed: cs.profile.passwordErrors.changed,
  feature_off: cs.profile.passwordErrors.featureOff,
}

export type Outcome = { done: true; toast: string } | { done: false; error: string }

export function outcomeOf(r: ChangePasswordResult): Outcome {
  if (!r.ok) return { done: false, error: SERVER_ERROR_TEXT[r.error] }
  return {
    done: true,
    toast: r.othersLoggedOut > 0 ? cs.profile.passwordChangedOthers : cs.profile.passwordChanged,
  }
}

/** The three password fields, in order: Return in one moves to the next, the last sends. */
export const PASSWORD_FIELDS = ['current', 'next', 'again'] as const
export type PasswordField = (typeof PASSWORD_FIELDS)[number]

export function nextField(field: PasswordField): PasswordField | null {
  const i = PASSWORD_FIELDS.indexOf(field)
  return PASSWORD_FIELDS[i + 1] ?? null
}
