import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { DemoAccounts } from './DemoAccounts'

// The public demo's one-tap logins (#328): four accounts and the multi-device viewer.

const render = (props: Partial<Parameters<typeof DemoAccounts>[0]> = {}) =>
  renderToStaticMarkup(
    <DemoAccounts busy={null} disabled={false} onPick={() => undefined} {...props} />,
  )

const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)]

describe('DemoAccounts', () => {
  it('offers the four accounts in the seed order, each a full tap target', () => {
    const html = render()
    expect(html).toContain(cs.demo.tryAs)
    const found = buttons(html)
    expect(found.map((m) => m[1])).toEqual(['Admin', 'Táta', 'Starší', 'Mladší'])
    for (const [tag] of found) expect(tag).toContain('min-h-tap')
  })

  it('links the multi-device viewer with its hint', () => {
    const html = render()
    expect(html).toMatch(/<a[^>]*href="\/dev\/multi"[^>]*>Více zařízení<\/a>/)
    expect(html).toContain(cs.demo.multiHint)
  })

  it('while a login runs every button is disabled and only the tapped one is busy', () => {
    const found = buttons(render({ busy: 'tata', disabled: true }))
    for (const [tag] of found) expect(tag).toMatch(/disabled=""/)
    expect(found.filter(([tag]) => tag.includes('aria-busy="true"')).map((m) => m[1])).toEqual([
      'Táta',
    ])
  })

  it('idle: no button is disabled or busy', () => {
    const html = render()
    expect(html).not.toContain('disabled=""')
    expect(html).not.toContain('aria-busy="true"')
  })
})
