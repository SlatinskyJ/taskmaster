import { describe, expect, it } from 'vitest'
import { formatDue, formatPragueDate } from './formatDate'

describe('formatPragueDate', () => {
  it.each([
    ['2026-11-17T23:30:00.000Z', '18. 11. 2026'],
    ['2026-11-17T22:59:59.000Z', '17. 11. 2026'],
    ['2026-06-30T22:30:00.000Z', '1. 7. 2026'],
  ])('%s → %s (Prague calendar day)', (iso, shown) => {
    expect(formatPragueDate(iso)).toBe(shown)
  })
})

describe('formatDue (#38: an instance row)', () => {
  // Tue 24 Nov 2026, 18:00 Prague = 17:00Z.
  const now = new Date('2026-11-24T17:00:00.000Z')
  const grace = (iso: string) => new Date(new Date(iso).getTime() + 3_600_000).toISOString()
  it.each([
    ['2026-11-24T19:00:00.000Z', 'do 20:00'],
    ['2026-11-25T06:00:00.000Z', 'do zítra 7:00'],
    ['2026-11-27T06:30:00.000Z', 'do pá 7:30'],
    // 23:30Z is already Wednesday 0:30 in Prague: tomorrow, not today.
    ['2026-11-24T23:30:00.000Z', 'do zítra 0:30'],
  ])('%s → %s', (dueAt, text) => {
    expect(formatDue(dueAt, grace(dueAt), now)).toBe(text)
  })
  it('"po termínu" from the end of grace on', () => {
    const due = '2026-11-24T15:00:00.000Z'
    expect(formatDue(due, now.toISOString(), now)).toBe('po termínu')
    const later = new Date(now.getTime() + 1).toISOString()
    expect(formatDue(due, later, now)).toBe('do 16:00')
  })
})
