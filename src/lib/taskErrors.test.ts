import { describe, expect, it } from 'vitest'
import { cs } from './strings'
import { taskErrorMessage } from './taskErrors'

describe('taskErrorMessage', () => {
  it.each([
    ['invalid_title', 'Napiš název (nejvýš 80 znaků).'],
    ['invalid_score', cs.tasks.errors.invalidScore],
    ['offer_changed', cs.tasks.errors.offerChanged],
    ['not_proposed', cs.tasks.errors.gone],
    ['not_found', cs.tasks.errors.gone],
    ['not_a_party', cs.login.failed],
    ['wrong_state', cs.tasks.errors.gone],
    ['reserved_by_other', cs.tasks.errors.reservedByOther],
    ['not_allowed', cs.tasks.errors.notAllowed],
    ['not_a_taker', cs.tasks.errors.notAllowed],
    ['reason_too_long', 'Důvod je moc dlouhý (nejvýš 200 znaků).'],
    ['same_score', 'Tohle číslo už platí. Zvol jiné.'],
    ['no_bids', 'Zatím nikdo nic nenabídl.'],
    ['no_bid', 'Nejdřív nabídni svou cenu.'],
    ['already_approved', 'Už jsi souhlasil(a).'],
  ])('%s → Czech message', (code, message) => {
    expect(taskErrorMessage(code)).toBe(message)
  })
})
