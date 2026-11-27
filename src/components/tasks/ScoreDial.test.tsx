import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DIAL_STEP_PX, dialKey, dialStep, dialStepPx, ScoreDial } from './ScoreDial'

describe('dialStep', () => {
  it('swiping left adds points, swiping right takes them away', () => {
    expect(dialStep(3, -DIAL_STEP_PX * 2, 1, 999).value).toBe(5)
    expect(dialStep(3, DIAL_STEP_PX, 1, 999).value).toBe(2)
  })

  it('rounds to the nearest step and keeps the leftover as offset', () => {
    expect(dialStep(3, -DIAL_STEP_PX * 0.4, 1, 999)).toEqual({
      value: 3,
      offset: -DIAL_STEP_PX * 0.4,
    })
    const past = dialStep(3, -DIAL_STEP_PX * 0.6, 1, 999)
    expect(past.value).toBe(4)
    expect(past.offset).toBeCloseTo(DIAL_STEP_PX * 0.4)
  })

  it('stops at the ends with no offset', () => {
    expect(dialStep(2, DIAL_STEP_PX * 5, 1, 999)).toEqual({ value: 1, offset: 0 })
    expect(dialStep(998, -DIAL_STEP_PX * 5, 1, 999)).toEqual({ value: 999, offset: 0 })
  })
})

describe('dialStepPx', () => {
  it('keeps the base gap while the current number and the next one have at most two digits', () => {
    expect(dialStepPx(1)).toBe(DIAL_STEP_PX)
    expect(dialStepPx(98)).toBe(DIAL_STEP_PX)
  })

  it('widens the gap from 99 up, when a three-digit number sits next to or in the middle (#190)', () => {
    expect(dialStepPx(99)).toBe(52)
    expect(dialStepPx(100)).toBe(52)
    expect(dialStepPx(998)).toBe(52)
  })
})

describe('dialStep with a wider gap', () => {
  it('counts swipe steps in the gap it is given', () => {
    expect(dialStep(100, -52 * 2, 1, 999, 52).value).toBe(102)
    expect(dialStep(100, -DIAL_STEP_PX * 2, 1, 999, 52).value).toBe(101)
    expect(dialStep(100, -52 * 0.4, 1, 999, 52)).toEqual({ value: 100, offset: -52 * 0.4 })
  })
})

describe('dialKey', () => {
  it('arrows step by one, page keys by five, Home/End jump to the ends', () => {
    expect(dialKey('ArrowRight', 3, 1, 999)).toBe(4)
    expect(dialKey('ArrowDown', 3, 1, 999)).toBe(2)
    expect(dialKey('ArrowLeft', 3, 1, 999)).toBe(2)
    expect(dialKey('ArrowUp', 3, 1, 999)).toBe(4)
    expect(dialKey('ArrowRight', 999, 1, 999)).toBe(999)
    expect(dialKey('ArrowLeft', 1, 1, 999)).toBe(1)
    expect(dialKey('PageUp', 3, 1, 999)).toBe(8)
    expect(dialKey('PageDown', 3, 1, 999)).toBe(1)
    expect(dialKey('Home', 3, 1, 999)).toBe(1)
    expect(dialKey('End', 3, 1, 999)).toBe(999)
    expect(dialKey('a', 3, 1, 999)).toBeNull()
  })
})

describe('ScoreDial', () => {
  it('is a labelled slider showing the value and its neighbours within range', () => {
    const html = renderToStaticMarkup(
      <ScoreDial value={2} min={1} max={999} onChange={() => undefined} label="Body" />,
    )
    expect(html).toContain('role="slider"')
    expect(html).toContain('aria-label="Body"')
    expect(html).toContain('aria-valuenow="2"')
    expect(html).not.toMatch(/>0</)
    expect(html).toMatch(/>7</)
    expect(html).toMatch(/<output aria-live="polite"[^>]*>2<\/output>/)
  })

  it('spaces the neighbours by the base gap for small values', () => {
    const html = renderToStaticMarkup(
      <ScoreDial value={10} min={1} max={999} onChange={() => undefined} label="Body" />,
    )
    expect(html).toContain('left:calc(50% + 36px)')
  })

  it("spaces three-digit neighbours wider, so they don't run into the middle number (#190)", () => {
    const html = renderToStaticMarkup(
      <ScoreDial value={100} min={1} max={999} onChange={() => undefined} label="Body" />,
    )
    expect(html).toContain('left:calc(50% + 52px)')
    expect(html).toContain('left:calc(50% + -52px)')
    expect(html).not.toContain('left:calc(50% + 36px)')
  })
})

describe('dialStep at the ends of the range (#281)', () => {
  it('drops the leftover offset once it hits an end, also for a swipe between steps', () => {
    // 5.3 steps right from 2: the value stops at 1 and the numbers don't drift past the end.
    expect(dialStep(2, DIAL_STEP_PX * 5.3, 1, 999)).toEqual({ value: 1, offset: 0 })
    expect(dialStep(998, -DIAL_STEP_PX * 5.3, 1, 999)).toEqual({ value: 999, offset: 0 })
  })
})

describe('ScoreDial: the numbers shown and their fade (#281)', () => {
  /** Each shown number with its classes, left position and opacity, in order. */
  const shown = (value: number, min = 1, max = 999) => {
    const html = renderToStaticMarkup(
      <ScoreDial value={value} min={min} max={max} onChange={() => undefined} label="Body" />,
    )
    return [
      ...html.matchAll(
        /<span aria-hidden="true" class="([^"]*)" style="left:calc\(50% \+ (-?\d+)px\);opacity:([\d.]+)">(\d+)</g,
      ),
    ].map(([, cls = '', left = '', opacity = '', n = '']) => ({
      n: Number(n),
      left: Number(left),
      opacity: Number(opacity),
      cls,
    }))
  }

  it('shows five numbers on each side of the value, no more', () => {
    expect(shown(10).map((s) => s.n)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('cuts the window at both ends of the range', () => {
    expect(shown(2, 1, 4).map((s) => s.n)).toEqual([1, 2, 3, 4])
    expect(shown(998).map((s) => s.n)).toEqual([993, 994, 995, 996, 997, 998, 999])
  })

  it('the value sits big in the middle, its neighbours fade with distance down to a floor', () => {
    const dial = shown(10)
    const mid = dial.find((s) => s.n === 10)
    expect(mid).toMatchObject({ left: 0, opacity: 1 })
    expect(mid?.cls).toContain('text-points text-ink')
    expect(mid?.cls).not.toContain('text-muted')
    for (const s of dial.filter((d) => d.n !== 10)) {
      const distance = Math.abs(s.n - 10)
      expect(s.left).toBe((s.n - 10) * DIAL_STEP_PX)
      expect(s.cls).toContain('text-lg text-muted')
      expect(s.cls).not.toContain('text-points')
      expect(s.opacity).toBeCloseTo(Math.max(0.25, 1 - distance * 0.18))
    }
    expect(dial.find((s) => s.n === 11)?.opacity).toBeCloseTo(0.82)
    expect(dial.find((s) => s.n === 7)?.opacity).toBeCloseTo(0.46)
    // Five away would be 0.1: the floor keeps it readable.
    expect(dial.find((s) => s.n === 15)?.opacity).toBe(0.25)
  })

  it('at rest the numbers slide with a transition that respects reduced motion', () => {
    for (const s of shown(10)) {
      expect(s.cls).toContain(
        'transition-[left] duration-200 ease-out motion-reduce:transition-none',
      )
      expect(s.cls).toContain('absolute top-1/2')
    }
  })
})
