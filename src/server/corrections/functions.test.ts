import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  featureFlags,
  pointAdjustments,
  settlementCorrections,
  settlements,
} from '~/server/db/schema'
import { doneTask, MEETING, plus, prague, SAT, week } from '~/server/settlement/testing'
import { getMeeting, settlePeriod } from '~/server/settlement'
import { must } from '~/server/tasks/testing'
import {
  adjustPointsHandler,
  correctSettlementHandler,
  parseAdjustPoints,
  parseCorrectSettlement,
} from './functions'

// The correction server functions (#48): thin wrappers over ./corrections.ts behind the launch
// switch `disputes`. The handlers are exactly what the server functions run.

const MONDAY = prague(2026, 11, 30, 10)

function withSwitch(enabled: boolean) {
  const f = week()
  f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'disputes')).run()
  doneTask(f, { score: 60, completedAt: plus(SAT, 1000), earner: f.starsi })
  const m = getMeeting(f.db, MEETING)
  if (!m.period) throw new Error('nothing to settle')
  must(
    settlePeriod(
      f.db,
      f.tata,
      m.period.id,
      m.takers.map((t) => ({ takerId: t.id, total: t.total })),
      MEETING,
    ),
  )
  const s = f.db.select().from(settlements).where(eq(settlements.takerId, f.starsi)).get()
  if (!s) throw new Error('no settlement')
  return { ...f, settlementId: s.id }
}

describe('parseAdjustPoints', () => {
  const ok = { takerId: 3, points: 5, reason: ' Pomoc. ', from: null }

  it('takes exactly takerId, points, reason and from; the reason stays as typed', () => {
    expect(parseAdjustPoints(ok)).toEqual(ok)
    expect(parseAdjustPoints({ ...ok, from: { disputeId: 2, seen: { points: 5 } } }).from).toEqual({
      disputeId: 2,
      seen: { points: 5 },
    })
    expect(() => parseAdjustPoints({ ...ok, extra: 1 })).toThrow()
    expect(() => parseAdjustPoints({ ...ok, from: { disputeId: 2, seen: null, x: 1 } })).toThrow()
    expect(() => parseAdjustPoints({ ...ok, from: { disputeId: 0, seen: null } })).toThrow()
    expect(() => parseAdjustPoints({ ...ok, takerId: 0 })).toThrow()
  })

  it('points: a whole number, not 0, at most 9999 either way', () => {
    expect(parseAdjustPoints({ ...ok, points: 9999 }).points).toBe(9999)
    expect(parseAdjustPoints({ ...ok, points: -9999 }).points).toBe(-9999)
    for (const points of [0, 1.5, 10000, -10000, '5']) {
      expect(() => parseAdjustPoints({ ...ok, points })).toThrow()
    }
  })

  it('reason: at most 1000 characters after trimming', () => {
    expect(parseAdjustPoints({ ...ok, reason: ` ${'a'.repeat(1000)} ` }).takerId).toBe(3)
    expect(() => parseAdjustPoints({ ...ok, reason: 'a'.repeat(1001) })).toThrow()
  })
})

describe('parseCorrectSettlement', () => {
  const ok = { settlementId: 4, level: 'upper', reason: 'Chyběl úkol.', from: null }

  it('takes exactly settlementId, level, reason and from', () => {
    expect(parseCorrectSettlement(ok)).toEqual(ok)
    expect(() => parseCorrectSettlement({ ...ok, level: 'middle' })).toThrow()
    expect(() => parseCorrectSettlement({ ...ok, settlementId: -1 })).toThrow()
    expect(() => parseCorrectSettlement({ ...ok, deducted: 50 })).toThrow()
    expect(() => parseCorrectSettlement({ ...ok, reason: 'a'.repeat(1001) })).toThrow()
  })
})

describe('handlers', () => {
  it('switch off: feature_off and nothing written', () => {
    const f = withSwitch(false)
    expect(
      adjustPointsHandler(
        f.db,
        f.admin,
        { takerId: f.starsi, points: 5, reason: 'x', from: null },
        MONDAY,
      ),
    ).toEqual({ ok: false, error: 'feature_off' })
    expect(
      correctSettlementHandler(
        f.db,
        f.admin,
        { settlementId: f.settlementId, level: 'none', reason: 'x', from: null },
        MONDAY,
      ),
    ).toEqual({ ok: false, error: 'feature_off' })
    expect(f.db.select().from(pointAdjustments).all()).toEqual([])
    expect(f.db.select().from(settlementCorrections).all()).toEqual([])
  })

  it('switch on: exactly { ok: true }, or the refusal', () => {
    const f = withSwitch(true)
    expect(
      adjustPointsHandler(
        f.db,
        f.admin,
        { takerId: f.starsi, points: 5, reason: 'x', from: null },
        MONDAY,
      ),
    ).toEqual({ ok: true })
    expect(
      correctSettlementHandler(
        f.db,
        f.admin,
        { settlementId: f.settlementId, level: 'none', reason: 'x', from: null },
        MONDAY,
      ),
    ).toEqual({ ok: true })
    expect(
      adjustPointsHandler(
        f.db,
        f.tata,
        { takerId: f.starsi, points: 5, reason: 'x', from: null },
        MONDAY,
      ),
    ).toEqual({ ok: false, error: 'not_admin' })
  })
})
