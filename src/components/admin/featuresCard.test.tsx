import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FEATURE_KEYS, NO_FEATURES } from '~/lib/features'
import { cs } from '~/lib/strings'
import { FeaturesCard } from './FeaturesCard'

// Funkce on Správa (#296), static markup: the switches, their state, the error state.

const t = cs.admin.features
const noop = () => undefined

describe('FeaturesCard', () => {
  it('a Funkce region with one switch per launch switch, its state readable', () => {
    const html = renderToStaticMarkup(
      <FeaturesCard
        features={{ ...NO_FEATURES, log: true }}
        failed={false}
        onToggle={noop}
        onRetry={noop}
      />,
    )
    expect(html).toMatch(/<section[^>]*aria-labelledby="admin-features-label"/)
    expect(html).toContain(`id="admin-features-label">${t.title}<`)
    const switches = html.match(/<button[^>]*role="switch"[^>]*>/g) ?? []
    expect(switches).toHaveLength(FEATURE_KEYS.length)
    expect(switches.filter((b) => b.includes('aria-checked="true"'))).toHaveLength(1)
    expect(html).toContain('aria-labelledby="feature-log-label"')
    expect(html).toContain(`${t.names.log.hint} · ${t.on}`)
    expect(html).toContain(`${t.names.week.hint} · ${t.off}`)
    expect(html).toContain(t.note)
    for (const b of switches) expect(b).toContain('min-h-tap')
  })

  it('a failed read: the message and a retry, no switches', () => {
    const html = renderToStaticMarkup(
      <FeaturesCard features={null} failed onToggle={noop} onRetry={noop} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain(t.failedLoad)
    expect(html).toContain(`>${t.retry}<`)
    expect(html).not.toContain('role="switch"')
  })

  it('locked on the demo (#328): every switch disabled, the lock note instead of the usual one', () => {
    const html = renderToStaticMarkup(
      <FeaturesCard features={NO_FEATURES} failed={false} locked onToggle={noop} onRetry={noop} />,
    )
    const switches = html.match(/<button[^>]*role="switch"[^>]*>/g) ?? []
    expect(switches).toHaveLength(FEATURE_KEYS.length)
    for (const b of switches) expect(b).toContain('disabled=""')
    expect(html).toContain(cs.demo.lockedNote)
    expect(html).not.toContain(t.note)
  })

  it('unlocked: switches enabled, the usual note, no lock note', () => {
    const html = renderToStaticMarkup(
      <FeaturesCard features={NO_FEATURES} failed={false} onToggle={noop} onRetry={noop} />,
    )
    expect(html).not.toContain('disabled=""')
    expect(html).toContain(t.note)
    expect(html).not.toContain(cs.demo.lockedNote)
  })
})
