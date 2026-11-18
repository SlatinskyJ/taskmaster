import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { OFFLINE_TOKENS, offlinePage } from './offline'

// The offline page carries its own copy of the Pastelky tokens (it loads without the app's
// stylesheet); this keeps the copy equal to src/styles/theme.css.

const css = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8')

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`No block for ${selector}`)
  const body = css.slice(start, css.indexOf('}', start))
  const tokens: Record<string, string> = {}
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
    if (name && value) tokens[name] = value.toLowerCase()
  }
  return tokens
}

const text = { title: 'Jsi offline', message: 'Zkus to znovu.', retry: 'Zkusit znovu' }

describe('offlinePage', () => {
  it('uses the light and system-dark tokens of theme.css', () => {
    const light = block(':root')
    const dark = { ...light, ...block(":root:not([data-theme='light'])") }
    for (const [name, value] of Object.entries(OFFLINE_TOKENS.light)) {
      expect([name, value]).toEqual([name, light[name]])
    }
    for (const [name, value] of Object.entries(OFFLINE_TOKENS.dark)) {
      expect([name, value]).toEqual([name, dark[name]])
    }
  })

  it('puts every token into the page', () => {
    const html = offlinePage('Taskmaster', text)
    for (const tokens of [OFFLINE_TOKENS.light, OFFLINE_TOKENS.dark]) {
      for (const [name, value] of Object.entries(tokens))
        expect(html).toContain(`--${name}:${value}`)
    }
  })

  it('is a Czech page with the given text, escaped', () => {
    const html = offlinePage('Taskmaster', {
      title: 'Jsi <offline>',
      message: 'a & b',
      retry: 'Znovu',
    })
    expect(html).toContain('<html lang="cs">')
    expect(html).toContain('Jsi &lt;offline&gt;')
    expect(html).toContain('a &amp; b')
    expect(html).not.toContain('<script')
  })

  it('keeps the retry button at least 44 px tall (UI doc touch target)', () => {
    expect(offlinePage('Taskmaster', text)).toMatch(/a\{[^}]*min-height:44px/)
  })
})
