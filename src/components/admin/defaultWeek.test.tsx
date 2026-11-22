import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { PeriodDefaults } from '~/domain'
import { cs } from '~/lib/strings'
import { DefaultWeekView, defaultsErrorMessage, trySave } from './DefaultWeekCard'
import type { DefaultWeekViewProps } from './DefaultWeekCard'

const D = DEFAULT_PERIOD_DEFAULTS
const noop = () => undefined

function view(over: Partial<DefaultWeekViewProps> = {}) {
  return renderToStaticMarkup(
    <DefaultWeekView
      saved={D}
      form={D}
      busy={false}
      error={null}
      onChange={noop}
      onSave={noop}
      {...over}
    />,
  )
}

/** The Uložit / Ukládám… button's opening tag. */
const saveButton = (html: string) =>
  new RegExp(
    `<button[^>]*>(?:(?!</button>).)*(?:${cs.admin.save}|${cs.admin.saving})</button>`,
  ).exec(html)?.[0] ?? ''

describe('Výchozí týden card (Správa, #47)', () => {
  it('shows the stored defaults: 7 dní, Sunday, 23:59, 50 and 100', () => {
    const html = view()
    expect(html).toContain(cs.admin.defaults.title)
    expect(html).toContain('7 dní')
    expect(html).toContain('neděle')
    expect(html).toContain('value="23:59"')
    expect(html).toContain('aria-valuenow="50"')
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain(cs.admin.defaults.hint)
  })

  it('Uložit is disabled until something changes', () => {
    expect(saveButton(view())).toMatch(/ disabled=""/)
    const changed: PeriodDefaults = { ...D, lengthDays: 14 }
    const html = view({ form: changed })
    expect(html).toContain('14 dní')
    expect(saveButton(html)).not.toMatch(/ disabled=""/)
  })

  it('Kratší is disabled at 7 days, Delší at 364 days', () => {
    const tag = (html: string, label: string) =>
      new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0] ?? ''
    const at7 = view()
    expect(tag(at7, 'Kratší')).toMatch(/ disabled=""/)
    expect(tag(at7, 'Delší')).not.toMatch(/ disabled=""/)
    const at364 = view({ form: { ...D, lengthDays: 364 } })
    expect(tag(at364, 'Delší')).toMatch(/ disabled=""/)
    expect(tag(at364, 'Kratší')).not.toMatch(/ disabled=""/)
  })

  it('each − / + has its own accessible name', () => {
    const html = view()
    for (const label of [
      'Kratší',
      'Delší',
      'Méně: Spodní hranice',
      'Více: Spodní hranice',
      'Méně: Horní hranice',
      'Více: Horní hranice',
    ]) {
      expect(html).toContain(`aria-label="${label}"`)
    }
  })

  it('shows Ukládám… and a disabled button while saving', () => {
    const html = view({ form: { ...D, lengthDays: 14 }, busy: true })
    expect(saveButton(html)).toMatch(/ disabled=""/)
    expect(saveButton(html)).toContain(cs.admin.saving)
  })

  it('shows the error and keeps the values', () => {
    const form = { ...D, levels: { lower: 60, upper: 120 } }
    const html = view({ form, error: cs.admin.defaults.failed })
    expect(html).toContain(cs.admin.defaults.failed)
    expect(html).toContain('aria-valuenow="60"')
    expect(saveButton(html)).not.toMatch(/ disabled=""/)
  })

  it('Czech messages for refusals and failures', () => {
    expect(defaultsErrorMessage('invalid_settings')).toBe(cs.admin.defaults.invalidSettings)
    expect(defaultsErrorMessage('not_admin')).toBe(cs.admin.errors.notAdmin)
    expect(defaultsErrorMessage('boom')).toBe(cs.admin.defaults.failed)
  })
})

describe('trySave', () => {
  it('a saved form shows no error', async () => {
    expect(await trySave(() => Promise.resolve(null), D)).toBeNull()
  })

  it('a refusal shows its Czech message', async () => {
    expect(await trySave(() => Promise.resolve('invalid_settings'), D)).toBe(
      cs.admin.defaults.invalidSettings,
    )
  })

  it('a network failure shows the generic message', async () => {
    expect(await trySave(() => Promise.reject(new Error('offline')), D)).toBe(
      cs.admin.defaults.failed,
    )
  })
})
