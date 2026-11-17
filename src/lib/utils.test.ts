import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('keeps a theme font size next to a text colour', () => {
    expect(cn('text-row text-ink')).toBe('text-row text-ink')
  })

  it('lets a later theme font size, radius or shadow win over an earlier one', () => {
    expect(cn('text-row text-ink', 'text-meta')).toBe('text-ink text-meta')
    expect(cn('rounded-card', 'rounded-full')).toBe('rounded-full')
    expect(cn('shadow-sticker', 'shadow-none')).toBe('shadow-none')
    expect(cn('font-body', 'font-display')).toBe('font-display')
  })
})
