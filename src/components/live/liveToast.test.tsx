import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import { LiveToast } from './LiveToast'

// The live change banner's markup (#299): the sentence whole, two 44 px icon buttons.

const LONG =
  'Táta · domluveno za 8 b · rezervace: Starší · Vyluxovat celý obývák a chodbu a pak ještě schody'

const render = (busy = false) =>
  renderToStaticMarkup(
    <LiveToast text={LONG} busy={busy} onRefresh={() => undefined} onClose={() => undefined} />,
  )

const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? []

describe('LiveToast', () => {
  it('holds the sentence whole, nothing cut', () => {
    const html = render()
    expect(html).toContain(LONG)
    expect(html).not.toMatch(/truncate|line-clamp|text-ellipsis/)
    expect(html).toContain('break-words')
  })

  it('two icon buttons with their labels, each a 44 px tap target that never shrinks', () => {
    const [refresh, close, ...rest] = buttons(render())
    expect(rest).toEqual([])
    expect(refresh).toContain(`aria-label="${cs.live.banner.refresh}"`)
    expect(close).toContain(`aria-label="${cs.live.banner.close}"`)
    for (const b of [refresh, close]) {
      expect(b).toMatch(/\bsize-tap\b/)
      expect(b).toMatch(/\bshrink-0\b/)
      expect(b).toContain('type="button"')
    }
    expect(cs.live.banner.refresh).toBe('Načíst změny')
  })

  it('not busy: refresh enabled, the icon still', () => {
    const html = render()
    expect(buttons(html)[0]).not.toContain('disabled=""')
    expect(html).not.toContain('animate-spin')
  })

  it('busy: refresh disabled and its icon spins, only without reduced motion', () => {
    const html = render(true)
    expect(buttons(html)[0]).toContain('disabled=""')
    expect(html).toContain('motion-safe:animate-spin')
    expect(html).not.toMatch(/(?<!motion-safe:)animate-spin/)
  })
})
