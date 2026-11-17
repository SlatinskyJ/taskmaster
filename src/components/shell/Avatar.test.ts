import { describe, expect, it } from 'vitest'
import { avatarColour, initial } from './Avatar'

describe('initial', () => {
  it('takes the first letter, upper case, Czech-aware', () => {
    expect(initial('táta')).toBe('T')
    expect(initial('  čenda')).toBe('Č')
  })

  it('falls back for an empty name', () => {
    expect(initial('')).toBe('?')
  })
})

describe('avatarColour', () => {
  it('is stable per person and differs between neighbours', () => {
    expect(avatarColour(3)).toBe(avatarColour(3))
    expect(avatarColour(1)).not.toBe(avatarColour(2))
  })

  it('only uses state text tokens, which theme.test.ts checks against the background', () => {
    for (let id = 0; id < 10; id++) expect(avatarColour(id)).toMatch(/^bg-state-\w+-text$/)
  })
})
