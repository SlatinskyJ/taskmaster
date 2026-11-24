import { describe, expect, it, vi } from 'vitest'
import { trackVisualViewport } from './visualViewport'

// The phone keyboard shrinks the visual viewport (#215). The tracker mirrors its top and height
// into CSS variables that the Dialog centres itself in.

type Win = Parameters<typeof trackVisualViewport>[0]

function fakeWindow(viewport: { offsetTop: number; height: number }, tagName = 'BODY') {
  const setProperty = vi.fn()
  const scrollIntoView = vi.fn()
  const vv = Object.assign(new EventTarget(), viewport)
  const doc = {
    documentElement: { style: { setProperty } },
    activeElement: { tagName, scrollIntoView },
  }
  const win = { visualViewport: vv, document: doc }
  return { win: win as unknown as Win, vv, setProperty, scrollIntoView }
}

describe('trackVisualViewport (#215)', () => {
  it('writes top and height at once', () => {
    const { win, setProperty } = fakeWindow({ offsetTop: 0, height: 852 })
    trackVisualViewport(win)
    expect(setProperty).toHaveBeenCalledWith('--vv-top', '0px')
    expect(setProperty).toHaveBeenCalledWith('--vv-height', '852px')
  })

  it('follows resize and scroll', () => {
    const { win, vv, setProperty } = fakeWindow({ offsetTop: 0, height: 852 })
    trackVisualViewport(win)
    Object.assign(vv, { height: 333 })
    vv.dispatchEvent(new Event('resize'))
    expect(setProperty).toHaveBeenLastCalledWith('--vv-height', '333px')
    Object.assign(vv, { offsetTop: 120 })
    vv.dispatchEvent(new Event('scroll'))
    expect(setProperty).toHaveBeenCalledWith('--vv-top', '120px')
  })

  it('cleanup stops updates', () => {
    const { win, vv, setProperty } = fakeWindow({ offsetTop: 0, height: 852 })
    const stop = trackVisualViewport(win)
    setProperty.mockClear()
    stop()
    Object.assign(vv, { height: 333, offsetTop: 120 })
    vv.dispatchEvent(new Event('resize'))
    vv.dispatchEvent(new Event('scroll'))
    expect(setProperty).not.toHaveBeenCalled()
  })

  it.each(['INPUT', 'TEXTAREA'])(
    'the keyboard opening scrolls the focused %s back into view',
    (tag) => {
      const { win, vv, scrollIntoView } = fakeWindow({ offsetTop: 0, height: 852 }, tag)
      trackVisualViewport(win)
      expect(scrollIntoView).not.toHaveBeenCalled()
      vv.dispatchEvent(new Event('resize'))
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    },
  )

  it('scrolling the visible part, or no field in focus, scrolls nothing', () => {
    const typing = fakeWindow({ offsetTop: 0, height: 852 }, 'INPUT')
    trackVisualViewport(typing.win)
    typing.vv.dispatchEvent(new Event('scroll'))
    expect(typing.scrollIntoView).not.toHaveBeenCalled()
    const idle = fakeWindow({ offsetTop: 0, height: 852 }, 'BUTTON')
    trackVisualViewport(idle.win)
    idle.vv.dispatchEvent(new Event('resize'))
    expect(idle.scrollIntoView).not.toHaveBeenCalled()
  })

  it('no visualViewport: writes nothing', () => {
    const setProperty = vi.fn()
    const win = {
      visualViewport: null,
      document: { documentElement: { style: { setProperty } }, activeElement: null },
    } as unknown as Win
    const stop = trackVisualViewport(win)
    expect(setProperty).not.toHaveBeenCalled()
    expect(() => {
      stop()
    }).not.toThrow()
  })
})
