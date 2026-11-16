import { describe, expect, it } from 'vitest'
import { cs, formatPoints, plural, pointWords } from './strings'

describe('Czech strings', () => {
  it('has a label for every item state from UI design doc §2.2', () => {
    expect(Object.keys(cs.state)).toEqual([
      'proposed',
      'negotiating',
      'open',
      'reserved',
      'pending',
      'confirmed',
      'expired',
      'cancelled',
      'rejected',
      'disputed',
    ])
    expect(cs.state.pending).toBe('Čeká na potvrzení')
    expect(cs.state.confirmed).toBe('Hotovo')
  })

  it('has no empty labels', () => {
    const walk = (node: unknown): string[] =>
      typeof node === 'string' ? [node] : Object.values(node as object).flatMap(walk)
    for (const label of walk(cs)) expect(label.trim()).not.toBe('')
  })
})

describe('plural', () => {
  it.each([
    [0, 'bodů'],
    [1, 'bod'],
    [2, 'body'],
    [4, 'body'],
    [5, 'bodů'],
    [11, 'bodů'],
    [12, 'bodů'],
    [21, 'bodů'],
    [22, 'bodů'],
    [100, 'bodů'],
    [-1, 'bod'],
    [-3, 'body'],
  ])('%d → %s', (n, word) => {
    expect(plural(n, pointWords)).toBe(word)
  })

  it('formats points with the number first', () => {
    expect(formatPoints(1)).toBe('1 bod')
    expect(formatPoints(3)).toBe('3 body')
    expect(formatPoints(45)).toBe('45 bodů')
  })
})
