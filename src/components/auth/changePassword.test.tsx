import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { ChangePasswordForm } from './ChangePasswordForm'
import {
  checkBeforeSending,
  EMPTY_PASSWORD_FORM,
  nextField,
  outcomeOf,
  SERVER_ERROR_TEXT,
} from './changePasswordForm'
import { ProfilePassword } from './ProfilePassword'

// Změnit heslo on Profil (#210). Typing and Return are exercised in e2e/password.spec.ts.

const filled = (next: string, again = next) => ({
  ...EMPTY_PASSWORD_FORM,
  current: 'demo1234',
  next,
  again,
})
const noop = () => Promise.resolve({ ok: true as const, othersLoggedOut: 0 })

describe('checks before sending', () => {
  it('a 7-character new password is refused, 8 goes', () => {
    expect(checkBeforeSending(filled('x'.repeat(7)))).toBe(cs.profile.passwordErrors.tooShort(8))
    expect(checkBeforeSending(filled('x'.repeat(8)))).toBeNull()
  })

  it('the two new passwords must match', () => {
    expect(checkBeforeSending(filled('noveheslo1', 'noveheslo2'))).toBe(
      cs.profile.passwordErrors.mismatch,
    )
  })

  it('the box starts ticked', () => {
    expect(EMPTY_PASSWORD_FORM.logOutOthers).toBe(true)
  })
})

describe('answers', () => {
  it('a change that logged others out says so; one that did not, does not', () => {
    expect(outcomeOf({ ok: true, othersLoggedOut: 2 })).toEqual({
      done: true,
      toast: 'Heslo je změněné. Ostatní zařízení jsou odhlášená.',
    })
    expect(outcomeOf({ ok: true, othersLoggedOut: 0 })).toEqual({
      done: true,
      toast: 'Heslo je změněné.',
    })
  })

  it('every server error has its Czech text', () => {
    expect(outcomeOf({ ok: false, error: 'feature_off' })).toEqual({
      done: false,
      error: 'Změna hesla je teď vypnutá.',
    })
    expect(outcomeOf({ ok: false, error: 'invalid_password' })).toEqual({
      done: false,
      error: 'Nové heslo musí mít aspoň 8 znaků.',
    })
    expect(outcomeOf({ ok: false, error: 'wrong_password' }).done).toBe(false)
    expect(SERVER_ERROR_TEXT).toStrictEqual({
      invalid_password: 'Nové heslo musí mít aspoň 8 znaků.',
      wrong_password: 'Současné heslo nesedí.',
      rate_limited: cs.login.rateLimited,
      changed: 'Heslo se mezitím změnilo. Zkus to znovu.',
      feature_off: 'Změna hesla je teď vypnutá.',
    })
  })

  it('Return moves current → new → again, and the last one sends', () => {
    expect(nextField('current')).toBe('next')
    expect(nextField('next')).toBe('again')
    expect(nextField('again')).toBeNull()
  })
})

describe('the form', () => {
  const html = renderToStaticMarkup(
    <ChangePasswordForm username="starsi" onSubmit={noop} onDone={() => undefined} />,
  )
  const input = (name: string) =>
    new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? ''

  it('tells password managers whose password it is', () => {
    expect(input('username')).toMatch(/autocomplete="username"/i)
    expect(input('username')).toMatch(/value="starsi"/)
    expect(input('username')).toMatch(/hidden/)
  })

  it('three password fields with the right keyboard keys and autofill', () => {
    expect(input('current')).toMatch(/type="password"/)
    expect(input('current')).toMatch(/autocomplete="current-password"/i)
    expect(input('current')).toMatch(/enterkeyhint="next"/i)
    expect(input('next')).toMatch(/autocomplete="new-password"/i)
    expect(input('next')).toMatch(/enterkeyhint="next"/i)
    expect(input('again')).toMatch(/autocomplete="new-password"/i)
    expect(input('again')).toMatch(/enterkeyhint="done"/i)
    for (const f of ['current', 'next', 'again']) expect(input(f)).toMatch(/maxlength="256"/i)
  })

  it('the log-out box is ticked by default', () => {
    expect(input('logOutOthers')).toMatch(/checked/)
    expect(html).toContain(cs.profile.logOutOthers)
  })
})

describe('Profil row', () => {
  it('hidden with the switch off, shown with it on', () => {
    expect(renderToStaticMarkup(<ProfilePassword enabled={false} username="starsi" />)).toBe('')
    expect(renderToStaticMarkup(<ProfilePassword enabled username="starsi" />)).toContain(
      cs.profile.passwordRow,
    )
  })
})
