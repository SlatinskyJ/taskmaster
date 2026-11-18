import { describe, expect, it } from 'vitest'
import { formatPragueDate } from './formatDate'

describe('formatPragueDate', () => {
  it.each([
    ['2026-11-17T23:30:00.000Z', '18. 11. 2026'],
    ['2026-11-17T22:59:59.000Z', '17. 11. 2026'],
    ['2026-06-30T22:30:00.000Z', '1. 7. 2026'],
  ])('%s → %s (Prague calendar day)', (iso, shown) => {
    expect(formatPragueDate(iso)).toBe(shown)
  })
})
