import { describe, expect, it } from 'vitest'
import { cs } from './strings'
import { scoreChangeErrorMessage, taskErrorMessage } from './taskErrors'

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
    ['feature_off', cs.tasks.errors.notAllowed],
    ['reason_too_long', 'Důvod je moc dlouhý (nejvýš 200 znaků).'],
    ['same_score', 'Tohle číslo už platí. Zvol jiné.'],
    ['no_bids', 'Zatím nikdo nic nenabídl.'],
    ['no_bid', 'Nejdřív nabídni svou cenu.'],
    ['past_grace', 'Termín už prošel, tohle už nejde.'],
    ['score_changed', 'Cena se mezitím změnila, podívej se znovu.'],
    ['already_open', 'Tenhle úkol už je zadaný. Najdeš ho na Domů.'],
    ['too_early', 'Tohle už patří do minulého týdne.'],
    ['invalid_schedule', 'Vyber aspoň jeden den.'],
    ['invalid_deadline', 'Termín nedává smysl. Zkontroluj ho.'],
    ['already_approved', 'Souhlas už máš zapsaný.'],
    ['no_offer', cs.tasks.errors.offerChanged],
    ['not_agreed', 'Tenhle opakovaný úkol ještě není domluvený.'],
  ])('%s → Czech message', (code, message) => {
    expect(taskErrorMessage(code)).toBe(message)
  })
})

describe('scoreChangeErrorMessage', () => {
  it.each([
    ['not_involved', cs.taskPrice.errors.notInvolved],
    ['change_pending', cs.taskPrice.errors.changePending],
    ['no_change', cs.taskPrice.errors.noChange],
    ['offer_changed', cs.taskPrice.errors.noChange],
    ['score_frozen', cs.taskPrice.errors.scoreFrozen],
    ['not_agreed', cs.taskPrice.errors.notAgreed],
    ['not_changeable', cs.tasks.errors.gone],
    ['wrong_state', cs.tasks.errors.gone],
    ['not_a_giver', cs.tasks.errors.notAllowed],
  ])('%s', (code, message) => {
    expect(scoreChangeErrorMessage(code)).toBe(message)
  })
})
