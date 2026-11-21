import { describe, expect, it } from 'vitest'
import { runningTotal } from '~/domain'
import { settlements } from '~/server/db/schema'
import { ledgerEntries } from './ledger'
import { doneTask, plus, reservedTask, SAT, week } from './testing'

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
