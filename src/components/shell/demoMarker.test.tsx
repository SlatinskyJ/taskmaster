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
  })

  it('renders nothing elsewhere', () => {
    expect(renderToStaticMarkup(<DemoMarker demo={false} />)).toBe('')
  })
})
