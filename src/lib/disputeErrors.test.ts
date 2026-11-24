import { describe, expect, it } from 'vitest'
import { disputeErrorMessage } from './disputeErrors'
import { cs } from './strings'

describe('disputeErrorMessage', () => {
  it.each([
    ['not_locked', 'Tohle se teď rozporovat nedá.'],
    ['dispute_open', 'Už je rozporováno.'],
    ['reason_required', 'Napiš, proč.'],
    ['not_found', 'Tohle už neexistuje.'],
    ['not_a_party', 'Rozporovat můžou jen děti a rodiče.'],
    ['feature_off', 'Rozporování je vypnuté.'],
    ['not_admin', cs.disputes.errors.generic],
    ['boom', cs.disputes.errors.generic],
  ])('%s → Czech message', (code, message) => {
    expect(disputeErrorMessage(code)).toBe(message)
  })
})
