import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FloatLayer } from './FloatLayer'
import { clearFloat, currentFloat, showFloat } from './floatStore'

const effects = vi.hoisted(() => ({ enabled: true }))
vi.mock('~/lib/effects', () => ({ useEffectsEnabled: () => effects.enabled }))

describe('FloatLayer (UI doc §4)', () => {
  beforeEach(() => {
    effects.enabled = true
    const f = currentFloat()
    if (f) clearFloat(f.key)
  })

  it('renders nothing while no float waits', () => {
    expect(renderToStaticMarkup(<FloatLayer />)).toBe('')
  })

  it('floats the +N fixed to the screen where the button was', () => {
    showFloat({ points: 5, tone: 'confirmed', rect: { left: 10, top: 20, width: 30, height: 40 } })
    const html = renderToStaticMarkup(<FloatLayer />)
    expect(html).toMatch(/class="[^"]*\bfixed\b/)
    expect(html).toContain('left:10px;top:20px;width:30px;height:40px')
    expect(html).toContain('+5')
    expect(html).toContain('text-state-confirmed')
  })

  it('shows no +N with Efekty off', () => {
    showFloat({ points: 5, tone: 'pending', rect: { left: 0, top: 0, width: 1, height: 1 } })
    effects.enabled = false
    expect(renderToStaticMarkup(<FloatLayer />)).not.toContain('+5')
  })

  it('does not replay a float once it was cleared (e.g. a later login on the same device)', () => {
    showFloat({ points: 5, tone: 'pending', rect: { left: 0, top: 0, width: 1, height: 1 } })
    clearFloat(currentFloat()?.key ?? 0)
    expect(renderToStaticMarkup(<FloatLayer />)).toBe('')
  })
})
