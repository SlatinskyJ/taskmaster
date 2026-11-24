import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import type { HistoryRecord, WeekAdjustment, WeekItem } from '~/server/settlement/functions'
import { adjustmentRow, correctionLine, historyLine, itemChip, itemMeta } from './weekView'

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
    const r = {
      id: 21,
      takerId: 3,
      name: 'Starší',
      level: 'upper' as const,
      dispute: null,
      correction: null,
      adjustments: [],
    }
    expect(historyLine({ ...r, totalBefore: 108, deducted: 100, carryOver: 8 })).toBe(
      'Celkem 108 · odečteno 100 · převod 8',
    )
    expect(historyLine({ ...r, level: 'none', totalBefore: 30, deducted: 0, carryOver: 30 })).toBe(
      'Celkem 30 · odečteno 0 · převod 30',
    )
  })
})

describe('adjustmentRow (#48)', () => {
  const a: WeekAdjustment = {
    id: 1,
    points: -20,
    reason: 'Rozbil hrnek.',
    at: '2026-11-24T23:30:00.000Z',
    fromWeek: null,
    waiting: false,
    dispute: null,
  }
  it('a counted manual one: confirmed chip, the day as meta, the reason as detail', () => {
    expect(adjustmentRow(a)).toEqual({
      name: cs.week.adjustment,
      state: 'confirmed',
      stateLabel: cs.week.counted,
      meta: 'st 25. 11.',
      detail: 'Rozbil hrnek.',
      points: '−20 b.',
    })
  })
  it('one waiting for the meeting: the pending chip', () => {
    const row = adjustmentRow({ ...a, waiting: true })
    expect(row.state).toBe('pending')
    expect(row.stateLabel).toBe(cs.week.waiting)
  })
  it('one from a correction: only the day as meta, its week before the reason in the detail', () => {
    const row = adjustmentRow({
      ...a,
      points: 50,
      fromWeek: { startsAt: '2026-11-14T19:00:00.000Z', endsAt: '2026-11-21T19:00:00.000Z' },
    })
    expect(row.name).toBe(cs.week.correctionRow)
    expect(row.meta).toBe('st 25. 11.')
    expect(row.detail).toBe(`${cs.week.fromWeek('14. 11. – 21. 11.')} · Rozbil hrnek.`)
  })
})

describe('correctionLine (#48)', () => {
  const r: HistoryRecord = {
    id: 1,
    takerId: 3,
    name: 'Starší',
    totalBefore: 108,
    level: 'upper',
    deducted: 100,
    carryOver: 8,
    dispute: null,
    correction: {
      level: 'lower',
      deducted: 50,
      reason: 'Chyběl úkol.',
      at: '2026-11-24T10:00:00.000Z',
    },
    adjustments: [],
  }
  it('upper → lower gives back the difference of the two deductions', () => {
    expect(correctionLine(r)).toBe(
      'Opraveno na úroveň Spodní hranice (původně Horní hranice): +50 b. · 24. 11. · Chyběl úkol.',
    )
  })
  it('lower → upper takes the difference', () => {
    const up = { ...r, level: 'lower' as const, deducted: 50 }
    up.correction = { level: 'upper', deducted: 100, reason: 'x', at: r.correction?.at ?? '' }
    expect(correctionLine(up)).toBe(
      cs.week.correctedLine('Horní hranice', 'Spodní hranice', -50, '24. 11.', 'x'),
    )
  })
  it('no correction: null', () => {
    expect(correctionLine({ ...r, correction: null })).toBeNull()
  })
})
