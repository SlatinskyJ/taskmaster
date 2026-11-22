import { describe, expect, it } from 'vitest'
import type { WeekItem } from '~/server/settlement/functions'
import { historyLine, itemChip, itemMeta } from './weekView'

const item = (over: Partial<WeekItem> = {}): WeekItem => ({
  taskId: 1,
  title: 'Vyndat myčku',
  score: 3,
  status: 'confirmed',
  at: '2026-11-24T23:30:00.000Z',
  reason: null,
  ...over,
})

describe('itemMeta', () => {
  it('the Prague day (a different day than UTC)', () => {
    expect(itemMeta(item())).toBe('st 25. 11.')
    expect(itemMeta(item({ status: 'done_unconfirmed' }))).toBe('st 25. 11.')
  })

  it('a rejection: the day it was rejected, the reason is not in the meta', () => {
    expect(itemMeta(item({ status: 'rejected', reason: 'Nedodělané' }))).toBe('st 25. 11.')
  })
})

describe('itemChip', () => {
  it.each([
    ['confirmed', 'confirmed'],
    ['done_unconfirmed', 'pending'],
    ['rejected', 'rejected'],
  ] as const)('%s → %s', (status, chip) => {
    expect(itemChip(item({ status }))).toBe(chip)
  })
})

describe('historyLine', () => {
  it('total, deducted, carry-over', () => {
    const r = { id: 21, takerId: 3, name: 'Starší', level: 'upper' as const, dispute: null }
    expect(historyLine({ ...r, totalBefore: 108, deducted: 100, carryOver: 8 })).toBe(
      'Celkem 108 · odečteno 100 · převod 8',
    )
    expect(historyLine({ ...r, level: 'none', totalBefore: 30, deducted: 0, carryOver: 30 })).toBe(
      'Celkem 30 · odečteno 0 · převod 30',
    )
  })
})
