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

  it('lets a later size or padding win over a theme spacing token', () => {
    expect(cn('size-tap', 'size-8')).toBe('size-8')
    expect(cn('min-h-tap', 'min-h-12')).toBe('min-h-12')
    expect(cn('p-card', 'p-0')).toBe('p-0')
    expect(cn('px-gutter', 'px-2')).toBe('px-2')
  })
})
