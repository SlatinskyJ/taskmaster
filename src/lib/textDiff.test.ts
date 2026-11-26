import { describe, expect, it } from 'vitest'
import { wordDiff } from './textDiff'

// What changed in a description (#207, Jakub 2026-11-26): words kept, added and removed, so a
// brother sees the difference before he says yes.

describe('wordDiff', () => {
  it('same text: one kept part', () => {
    expect(wordDiff('Zamést podlahu.', 'Zamést podlahu.')).toEqual([
      { kind: 'same', text: 'Zamést podlahu.' },
    ])
  })

  it('an added line at the end', () => {
    expect(wordDiff('Všechny krabice.', 'Všechny krabice.\nPrázdné složit.')).toEqual([
      { kind: 'same', text: 'Všechny krabice.' },
      { kind: 'added', text: '\nPrázdné složit.' },
    ])
  })

  it('a word swapped in the middle', () => {
    expect(wordDiff('Umýt okna v kuchyni.', 'Umýt okna v obýváku.')).toEqual([
      { kind: 'same', text: 'Umýt okna v ' },
      { kind: 'removed', text: 'kuchyni' },
      { kind: 'added', text: 'obýváku' },
      { kind: 'same', text: '.' },
    ])
  })

  it('a removed word', () => {
    expect(wordDiff('Police, stůl i parapet.', 'Police i parapet.')).toEqual([
      { kind: 'same', text: 'Police' },
      { kind: 'removed', text: ', stůl' },
      { kind: 'same', text: ' i parapet.' },
    ])
  })

  it('two changed words in a row: one removed part, one added part, spaces between kept', () => {
    expect(wordDiff('a b c', 'x y c')).toEqual([
      { kind: 'removed', text: 'a b' },
      { kind: 'added', text: 'x y' },
      { kind: 'same', text: ' c' },
    ])
  })

  it('a moved word: only that word changes, the rest stays', () => {
    expect(wordDiff('Umýt okna v kuchyni', 'Umýt v kuchyni okna')).toEqual([
      { kind: 'same', text: 'Umýt ' },
      { kind: 'removed', text: 'okna ' },
      { kind: 'same', text: 'v kuchyni' },
      { kind: 'added', text: ' okna' },
    ])
  })

  it('from or to nothing', () => {
    expect(wordDiff('', 'Nový text.')).toEqual([{ kind: 'added', text: 'Nový text.' }])
    expect(wordDiff('Starý text.', '')).toEqual([{ kind: 'removed', text: 'Starý text.' }])
    expect(wordDiff('', '')).toEqual([])
  })

  it('joining the parts of each side gives back the old and the new text', () => {
    const a = 'Zamést celou podlahu.\nKola pověsit na háky.'
    const b = 'Zamést i pod regálem.\nKola pověsit na háky, helmy do skříně.'
    const parts = wordDiff(a, b)
    const join = (skip: string) =>
      parts
        .filter((p) => p.kind !== skip)
        .map((p) => p.text)
        .join('')
    expect(join('added')).toBe(a)
    expect(join('removed')).toBe(b)
  })

  it('two 1000-letter texts: right, and fast enough to render on tap', () => {
    const a = 'slovo '.repeat(166)
    const b = 'jiné '.repeat(200)
    const t = performance.now()
    const parts = wordDiff(a, b)
    // Generous: a phone takes a few ms; the bound only catches a runaway, and must hold under
    // mutation testing's instrumented runs too (CI took 218 ms there).
    expect(performance.now() - t).toBeLessThan(2000)
    const side = (skip: string) =>
      parts
        .filter((p) => p.kind !== skip)
        .map((p) => p.text)
        .join('')
    expect(side('added')).toBe(a)
    expect(side('removed')).toBe(b)
  })
})
