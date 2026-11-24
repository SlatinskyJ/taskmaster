import { describe, expect, it } from 'vitest'
import { fixErrorMessage } from './fixErrors'
import { cs } from './strings'

// Czech messages for a correction or adjustment the server refused (#48).
describe('fixErrorMessage', () => {
  const f = cs.admin.fix.errors
  const d = cs.admin.disputes.errors
  it.each([
    ['week_waiting', f.week_waiting],
    ['would_go_negative', f.would_go_negative],
    ['no_change', f.no_change],
    ['reason_required', f.reason_required],
    ['value_changed', d.value_changed],
    ['not_open', d.not_open],
    ['not_found', d.not_found],
    ['feature_off', cs.disputes.errors.feature_off],
  ])('%s', (code, text) => {
    expect(fixErrorMessage(code)).toBe(text)
  })

  it.each(['not_admin', 'invalid_points', 'wrong_correction', 'nonsense'])(
    '%s → the generic text',
    (code) => {
      expect(fixErrorMessage(code)).toBe(cs.disputes.errors.generic)
    },
  )
})
