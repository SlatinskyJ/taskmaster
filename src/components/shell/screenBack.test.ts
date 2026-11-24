import { describe, expect, it, vi } from 'vitest'
import { historyBack } from './Screen'

// The back arrow of a task or chore page (#205): back where the person came from in the app,
// else the link's own Domů.
describe('historyBack', () => {
  it('with in-app history: goes back and stops the link', () => {
    const history = { canGoBack: () => true, back: vi.fn() }
    const e = { preventDefault: vi.fn() }
    historyBack(history)(e)
    expect(history.back).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('opened cold: the link goes to Domů', () => {
    const history = { canGoBack: () => false, back: vi.fn() }
    const e = { preventDefault: vi.fn() }
    historyBack(history)(e)
    expect(history.back).not.toHaveBeenCalled()
    expect(e.preventDefault).not.toHaveBeenCalled()
  })
})
