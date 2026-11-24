import { describe, expect, it } from 'vitest'
import { runningTotal } from '~/domain'
import { settlements } from '~/server/db/schema'
import { ledgerEntries, takerPointsNow } from './ledger'
import { adjustment, doneTask, plus, reservedTask, SAT, week } from './testing'

describe('ledgerEntries', () => {
  it('ledger: completions before the end and every deduction', () => {
    const f = week()
    doneTask(f, { score: 40, completedAt: plus(SAT, 1000), earner: f.starsi })
    // Left out: reserved, waiting for approval, closed "bez bodů" (no earner).
    reservedTask(f, f.starsi, 7)
    doneTask(f, {
      score: 9,
      completedAt: plus(SAT, 2000),
      earner: f.starsi,
      status: 'done_unconfirmed',
    })
    doneTask(f, { score: 11, completedAt: plus(SAT, 3000), earner: null, reservedBy: f.starsi })
    // Reserved by starsi, earned by mladsi: mladsi gets it.
    doneTask(f, { score: 5, completedAt: plus(SAT, 4000), earner: f.mladsi, reservedBy: f.starsi })
    f.db
      .insert(settlements)
      .values({
        periodId: f.p1.id,
        takerId: f.starsi,
        totalBefore: 40,
        level: 'none',
        deducted: 0,
        carryOver: 40,
        settledBy: f.tata,
        settledAt: plus(SAT, 5000).toISOString(),
      })
      .run()
    const entries = ledgerEntries(f.db)
    expect(entries).toEqual([
      { kind: 'completion', takerId: f.starsi, points: 40 },
      { kind: 'completion', takerId: f.mladsi, points: 5 },
      { kind: 'settlement', takerId: f.starsi, deducted: 0 },
    ])
    expect(runningTotal(entries, f.starsi)).toBe(40)
    expect(runningTotal(entries, f.mladsi)).toBe(5)
  })

  it('ledger: until is exclusive and keyed on completed_at', () => {
    const f = week()
    const until = plus(SAT, 60_000)
    doneTask(f, { score: 3, completedAt: until, earner: f.starsi })
    // Done just before, approved long after: still counts.
    doneTask(f, {
      score: 4,
      completedAt: plus(until, -1),
      earner: f.starsi,
      updatedAt: plus(until, 3_600_000),
    })
    expect(runningTotal(ledgerEntries(f.db, until), f.starsi)).toBe(4)
    expect(runningTotal(ledgerEntries(f.db), f.starsi)).toBe(7)
  })
})

describe('takerPointsNow', () => {
  it('confirmed is the running total, pending the waiting scores by earner', () => {
    const f = week()
    doneTask(f, { score: 60, completedAt: plus(SAT, 1000), earner: f.starsi })
    doneTask(f, { score: 25, completedAt: plus(SAT, 1000), earner: f.mladsi })
    f.db
      .insert(settlements)
      .values({
        periodId: f.p1.id,
        takerId: f.starsi,
        totalBefore: 60,
        level: 'lower',
        deducted: 50,
        carryOver: 10,
        settledBy: f.tata,
        settledAt: plus(SAT, 5000).toISOString(),
      })
      .run()
    doneTask(f, {
      score: 9,
      completedAt: plus(SAT, 2000),
      earner: f.starsi,
      status: 'done_unconfirmed',
    })
    doneTask(f, {
      score: 2,
      completedAt: plus(SAT, 2000),
      earner: f.starsi,
      status: 'done_unconfirmed',
    })
    doneTask(f, {
      score: 3,
      completedAt: plus(SAT, 2000),
      earner: f.mladsi,
      status: 'done_unconfirmed',
    })
    reservedTask(f, f.starsi, 7)
    const points = takerPointsNow(f.db)
    expect(points.get(f.starsi)).toEqual({ confirmed: 10, pending: 11 })
    expect(points.get(f.mladsi)).toEqual({ confirmed: 25, pending: 3 })
    expect(points.get(f.tata)).toBeUndefined()
  })

  it('a taker with only pending points has confirmed 0', () => {
    const f = week()
    doneTask(f, {
      score: 5,
      completedAt: plus(SAT, 2000),
      earner: f.mladsi,
      status: 'done_unconfirmed',
    })
    expect(takerPointsNow(f.db).get(f.mladsi)).toEqual({ confirmed: 0, pending: 5 })
  })
})

describe('adjustments in the ledger (#48)', () => {
  it('takerPointsNow adds a +7 and a −3 adjustment to confirmed', () => {
    const f = week()
    doneTask(f, { score: 20, completedAt: plus(SAT, 1000), earner: f.starsi })
    adjustment(f, f.starsi, 7, plus(SAT, 2000))
    adjustment(f, f.starsi, -3, plus(SAT, 3000))
    expect(takerPointsNow(f.db).get(f.starsi)).toEqual({ confirmed: 24, pending: 0 })
    expect(ledgerEntries(f.db)).toContainEqual({ kind: 'adjustment', takerId: f.starsi, points: 7 })
  })

  it('until is exclusive on made_at', () => {
    const f = week()
    const until = plus(SAT, 60_000)
    adjustment(f, f.starsi, 5, until)
    adjustment(f, f.starsi, 2, plus(until, -1))
    expect(runningTotal(ledgerEntries(f.db, until), f.starsi)).toBe(2)
    expect(runningTotal(ledgerEntries(f.db), f.starsi)).toBe(7)
  })
})
