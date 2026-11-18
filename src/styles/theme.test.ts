import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cs, type ItemStateKey } from '~/lib/strings'

// Checks the real stylesheet: WCAG AA (4.5:1) for every text token, in light and dark
// (issue #30, UI doc §2.2 "text colours ... reach 4.5:1").

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')

type Tokens = Record<string, string>

function block(selector: string): Tokens {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`No block for ${selector}`)
  const body = css.slice(start, css.indexOf('}', start))
  const tokens: Tokens = {}
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
    const [, name, value] = m
    if (name && value) tokens[name] = value.toLowerCase()
  }
  return tokens
}

const light = block(':root')
const darkSystem = block(":root:not([data-theme='light'])")
const darkForced = block(":root[data-theme='dark']")
const dark = { ...light, ...darkSystem }

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** `color-mix(in srgb, dot 15%, surface)`: the chip background (UI doc §2.2). */
function chipBackground(dot: string, surface: string): string {
  const d = channels(dot)
  const s = channels(surface)
  return `#${d
    .map((c, i) =>
      Math.round(c * 0.15 + (s[i] ?? 0) * 0.85)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/** Every state the app can show, from the strings module the chips use. */
const STATES = Object.keys(cs.state) as ItemStateKey[]

function tok(t: Tokens, name: string): string {
  const v = t[name]
  if (!v) throw new Error(`Missing token --${name}`)
  return v
}

describe('theme.css', () => {
  it('has the same dark tokens for "system dark" and "forced dark"', () => {
    expect(darkForced).toEqual(darkSystem)
  })

  it('defines every light token in dark mode too', () => {
    expect(Object.keys(darkSystem).sort()).toEqual(Object.keys(light).sort())
  })

  it('uses the Pastelky base colours from UI doc §2.1', () => {
    expect([light.bg, light.surface, light.ink, light.accent, light['accent-strong']]).toEqual([
      '#fff5ee',
      '#ffffff',
      '#2b1f2e',
      '#f2545b',
      '#d93a42',
    ])
    expect([dark.bg, dark.surface, dark.ink, dark.accent]).toEqual([
      '#1d1524',
      '#2a1f33',
      '#fff1e8',
      '#ff6a70',
    ])
  })

  for (const [mode, t] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    describe(`${mode}: text reaches 4.5:1`, () => {
      it.each(['ink', 'muted'])('%s on bg and surface', (name) => {
        expect(contrast(tok(t, name), tok(t, 'bg'))).toBeGreaterThanOrEqual(4.5)
        expect(contrast(tok(t, name), tok(t, 'surface'))).toBeGreaterThanOrEqual(4.5)
      })

      it('button labels on primary and ok', () => {
        expect(
          contrast(tok(t, 'on-accent-strong'), tok(t, 'accent-strong')),
        ).toBeGreaterThanOrEqual(4.5)
        expect(contrast(tok(t, 'on-ok'), tok(t, 'ok'))).toBeGreaterThanOrEqual(4.5)
      })

      it.each(STATES)('state %s text on surface, on the page and on its chip', (state) => {
        const text = tok(t, `s-${state}-text`)
        const surface = tok(t, 'surface')
        expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5)
        // Also the page background: avatars put a `bg`-coloured initial on these (Avatar.tsx).
        expect(contrast(text, tok(t, 'bg'))).toBeGreaterThanOrEqual(4.5)
        expect(
          contrast(text, chipBackground(tok(t, `s-${state}`), surface)),
        ).toBeGreaterThanOrEqual(4.5)
      })
    })
  }
})
