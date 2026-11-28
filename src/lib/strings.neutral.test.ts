import { describe, expect, it } from 'vitest'
import { cs } from './strings'

// Jakub 2026-11-28 (#353): takers can be girls; no Czech line assumes boys.
// No \b after a Czech letter: JS \b knows ASCII letters only.
const NOT_LETTER = '(?![a-zěščřžýáíéůúóťďň])'
const BOY_ONLY = [
  /\bkluk/i,
  /\bkluc/i,
  new RegExp(`\\brezervoval${NOT_LETTER}`, 'i'),
  new RegExp(`\\budělal${NOT_LETTER}`, 'i'),
  /sám od sebe/i,
  new RegExp(`by šel${NOT_LETTER}`, 'i'),
]

/** Each function is called with every parameter set to one of these, so each branch shows. */
const SAMPLES: readonly unknown[] = [1, 'x', true, false, 2, 5]

interface Walked {
  strings: string[]
  /** Key paths of functions that gave no string for any sample. */
  unreadable: string[]
}

function walk(value: unknown, path: string, out: Walked): void {
  if (typeof value === 'string') {
    out.strings.push(value)
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => {
      walk(v, `${path}[${String(i)}]`, out)
    })
  } else if (typeof value === 'function') {
    const fn = value as (...args: unknown[]) => unknown
    let any = false
    for (const sample of SAMPLES) {
      let result: unknown
      try {
        result = fn(...Array.from({ length: fn.length }, () => sample))
      } catch {
        continue
      }
      if (typeof result === 'string') {
        any = true
        out.strings.push(result)
      }
    }
    if (!any) out.unreadable.push(path)
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, out)
  }
}

function allStrings(value: unknown): Walked {
  const out: Walked = { strings: [], unreadable: [] }
  walk(value, '', out)
  return out
}

describe('Czech strings (#353)', () => {
  const walked = allStrings(cs)

  it('reads every value: each function gives a string for some sample', () => {
    expect(walked.unreadable).toEqual([])
    expect(walked.strings.length).toBeGreaterThan(500)
  })

  it('no Czech string assumes the takers are boys', () => {
    const found = walked.strings.filter((s) => BOY_ONLY.some((re) => re.test(s)))
    expect(found).toEqual([])
  })

  it('the guard catches each boy-only form it lists', () => {
    for (const s of [
      'jeden z kluků',
      'Kluci tento týden',
      'Rezervoval Béďa',
      'Udělal Anička',
      'Udělal jsi něco sám od sebe?',
      'Celkem by šel pod nulu.',
    ]) {
      expect(
        BOY_ONLY.some((re) => re.test(s)),
        s,
      ).toBe(true)
    }
    for (const s of ['Rezervovala', 'Udělala', 'Rezervace: Anička', 'Hotovo: Béďa', 'by šelma']) {
      expect(
        BOY_ONLY.some((re) => re.test(s)),
        s,
      ).toBe(false)
    }
  })
})
