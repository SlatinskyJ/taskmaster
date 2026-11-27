import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { DemoMarker } from './DemoMarker'

// The demo marker (#328): on every screen of the public demo, nowhere else.
describe('DemoMarker', () => {
  it('shows on the demo', () => {
    const html = renderToStaticMarkup(<DemoMarker demo />)
    expect(html).toContain('data-slot="demo-marker"')
    expect(html).toContain(cs.demo.marker)
    // Surface on the proposed-state text colour: a pair theme.test.ts holds to 4.5:1 in both themes.
    expect(html).toContain('bg-state-proposed-text')
    expect(html).toContain('text-surface')
  })

  it('renders nothing elsewhere', () => {
    expect(renderToStaticMarkup(<DemoMarker demo={false} />)).toBe('')
  })
})
