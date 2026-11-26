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
