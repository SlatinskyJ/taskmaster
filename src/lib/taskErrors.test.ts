import { describe, expect, it } from 'vitest'
import { cs } from './strings'
import { taskErrorMessage } from './taskErrors'

describe('taskErrorMessage', () => {
  it.each([
    ['invalid_title', cs.tasks.errors.invalidTitle],
    ['invalid_score', cs.tasks.errors.invalidScore],
    ['offer_changed', cs.tasks.errors.offerChanged],
    ['not_proposed', cs.tasks.errors.gone],
    ['not_found', cs.tasks.errors.gone],
    ['not_a_party', cs.login.failed],
  ])('%s → Czech message', (code, message) => {
    expect(taskErrorMessage(code)).toBe(message)
  })
})
