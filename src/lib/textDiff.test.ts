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

  it('a 1000-letter text is fast enough', () => {
    const a = 'slovo '.repeat(166)
    const b = 'jiné '.repeat(200)
    const t = performance.now()
    wordDiff(a, b)
    expect(performance.now() - t).toBeLessThan(200)
  })
})
