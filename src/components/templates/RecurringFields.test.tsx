import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import type { RecurringValue } from './actions'
import { DEFAULT_RECURRING } from './actions'
import { RecurringFields } from './RecurringFields'

const render = (change: Partial<RecurringValue>) =>
  renderToStaticMarkup(
    <RecurringFields value={{ ...DEFAULT_RECURRING, ...change }} onChange={() => undefined} />,
  )

/** The `<button>` whose text is exactly `label`. */
const button = (html: string, label: string) =>
  [...html.matchAll(/<button[^>]*>.*?<\/button>/g)]
    .map((m) => m[0])
    .find((b) => b.endsWith(`>${label}</button>`))

describe('RecurringFields', () => {
  it('Út picked: pressed; the other days not', () => {
    const html = render({ days: [2] })
    expect(button(html, 'Út')).toContain('aria-pressed="true"')
    for (const d of ['Po', 'St', 'Čt', 'Pá', 'So', 'Ne']) {
      expect(button(html, d)).toContain('aria-pressed="false"')
    }
  })

  it('no day picked: says "on demand" and hides the time controls', () => {
    const html = render({ days: [] })
    expect(html).toContain(cs.templates.onDemandHint)
    expect(html).not.toContain('type="time"')
    expect(html).not.toContain(cs.templates.withTime)
  })

  it('a day picked: time checkbox and input', () => {
    const html = render({ days: [2] })
    expect(html).toContain(cs.templates.withTime)
    expect(html).toContain('type="time"')
    expect(html).not.toContain(cs.templates.onDemandHint)
  })

  it('time off: the midnight hint, no time input', () => {
    const html = render({ days: [2], withTime: false })
    expect(html).toContain(cs.templates.noTimeHint)
    expect(html).not.toContain('type="time"')
  })

  it('deadline fields only with a deadline', () => {
    expect(render({ hasDeadline: false })).not.toContain(cs.templates.grace)
    const html = render({ hasDeadline: true })
    expect(html).toContain(cs.templates.grace)
    expect(html).toContain(cs.templates.dueDay)
  })

  it('grace stepper: − disabled at 0, + disabled at 48', () => {
    const at0 = render({ hasDeadline: true, graceHours: 0 })
    expect(button(at0, '−')).toContain('disabled=""')
    expect(button(at0, '+')).not.toContain('disabled=""')
    const at48 = render({ hasDeadline: true, graceHours: 48 })
    expect(button(at48, '+')).toContain('disabled=""')
    expect(button(at48, '−')).not.toContain('disabled=""')
  })

  it('day buttons are full tap size in one seven-column row', () => {
    const html = render({ days: [] })
    expect(html).toContain('grid-cols-7')
    expect(button(html, 'Po')).toContain('size-tap')
  })
})
