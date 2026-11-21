import { describe, expect, it } from 'vitest'
import { settleErrorMessage } from './settleErrors'
import { cs } from './strings'

const e = cs.meeting.errors

describe('settleErrorMessage', () => {
  it.each([
    ['totals_changed', 'Mezitím se změnily body. Zkontroluj je a potvrď znovu.'],
    ['pending_items', 'Přibylo něco ke schválení.'],
    ['already_settled', 'Týden už je vyúčtovaný.'],
    ['wrong_period', 'Týden už je vyúčtovaný.'],
    ['nothing_to_settle', 'Týden už je vyúčtovaný.'],
    ['no_takers', 'Zatím tu nejsou žádné děti.'],
    ['not_a_giver', e.generic],
    ['not_found', e.generic],
    ['not_running', e.generic],
  ])('%s → Czech message', (code, message) => {
    expect(settleErrorMessage(code)).toBe(message)
  })

  it('the four refusals a giver can meet each read differently from the generic one', () => {
    const texts = (
      ['totals_changed', 'pending_items', 'already_settled', 'no_takers'] as const
    ).map(settleErrorMessage)
    expect(new Set([...texts, e.generic]).size).toBe(5)
    expect(texts.every((t) => t.length > 0)).toBe(true)
  })
})
