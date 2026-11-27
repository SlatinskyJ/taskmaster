import { describe, expect, it, vi } from 'vitest'
import { fromToaster, keepOpenForToaster } from './outside'

// A tap on the live change banner is not a tap outside an open dialog or sheet (#299).

const el = (inToaster: boolean) => ({
  closest: (sel: string) => (inToaster && sel === '[data-sonner-toaster]' ? {} : null),
})

describe('fromToaster', () => {
  it('true inside the toaster, false outside it', () => {
    expect(fromToaster(el(true) as unknown as EventTarget)).toBe(true)
    expect(fromToaster(el(false) as unknown as EventTarget)).toBe(false)
  })

  it('null and a target that is no element: false', () => {
    expect(fromToaster(null)).toBe(false)
    expect(fromToaster({} as EventTarget)).toBe(false)
  })
})

describe('keepOpenForToaster', () => {
  const event = (inToaster: boolean) => {
    const prevent = vi.fn()
    const e = { target: el(inToaster), preventDefault: prevent } as unknown as Event
    return { e, prevent }
  }

  it('prevents the close for a toaster target, then runs the own handler', () => {
    const own = vi.fn()
    const { e, prevent } = event(true)
    keepOpenForToaster(own)(e)
    expect(prevent).toHaveBeenCalledTimes(1)
    expect(own).toHaveBeenCalledWith(e)
  })

  it('leaves any other target to the own handler, also without one', () => {
    const own = vi.fn()
    const { e, prevent } = event(false)
    keepOpenForToaster(own)(e)
    keepOpenForToaster()(e)
    expect(prevent).not.toHaveBeenCalled()
    expect(own).toHaveBeenCalledTimes(1)
  })
})
