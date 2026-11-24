import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { MEETING, week } from '~/server/settlement/testing'
import { pointAdjustments, settlementCorrections, settlements } from './schema'

// The DB backs up the correction rules (spec §5.9, #48): both tables are append-only, a
// correction's level and deduction agree, an adjustment is never 0, a reason is 1–1000
// characters after trimming, and a correction posts at most one adjustment.
const AT = MEETING.toISOString()

function setup() {
  const f = week()
  const settlementId = f.db
    .insert(settlements)
    .values({
      periodId: f.p1.id,
      takerId: f.starsi,
      totalBefore: 60,
      level: 'lower',
      deducted: 50,
      carryOver: 10,
      settledBy: f.tata,
      settledAt: AT,
    })
    .returning()
    .get().id
  const correction = {
    settlementId,
    level: 'upper' as const,
    deducted: 100,
    reason: 'Úkol z neděle chyběl.',
    madeBy: f.admin,
    madeAt: AT,
  }
  const adjustment = {
    takerId: f.starsi,
    points: 5,
    reason: 'Pomoc s nákupem.',
    madeBy: f.admin,
    madeAt: AT,
  }
  return { ...f, settlementId, correction, adjustment }
}

describe('settlement_corrections table', () => {
  it('stores a correction; never updated or deleted', () => {
    const { db, correction } = setup()
    const id = db.insert(settlementCorrections).values(correction).returning().get().id
    expect(() =>
      db
        .update(settlementCorrections)
        .set({ reason: 'Jinak.' })
        .where(eq(settlementCorrections.id, id))
        .run(),
    ).toThrow(/final/)
    expect(() =>
      db.delete(settlementCorrections).where(eq(settlementCorrections.id, id)).run(),
    ).toThrow(/final/)
  })

  it('level and deduction agree', () => {
    const { db, correction } = setup()
    expect(() =>
      db
        .insert(settlementCorrections)
        .values({ ...correction, level: 'none', deducted: 5 })
        .run(),
    ).toThrow(/CHECK/)
    expect(() =>
      db
        .insert(settlementCorrections)
        .values({ ...correction, level: 'lower', deducted: 0 })
        .run(),
    ).toThrow(/CHECK/)
    db.insert(settlementCorrections)
      .values({ ...correction, level: 'none', deducted: 0 })
      .run()
  })

  it('reason: 1–1000 characters after trimming', () => {
    const { db, correction } = setup()
    for (const reason of ['', '   ', 'a'.repeat(1001)]) {
      expect(() =>
        db
          .insert(settlementCorrections)
          .values({ ...correction, reason })
          .run(),
      ).toThrow(/CHECK/)
    }
    db.insert(settlementCorrections)
      .values({ ...correction, reason: 'a'.repeat(1000) })
      .run()
  })

  it('names an existing settlement', () => {
    const { db, correction } = setup()
    expect(() =>
      db
        .insert(settlementCorrections)
        .values({ ...correction, settlementId: 999 })
        .run(),
    ).toThrow(/FOREIGN KEY/)
  })
})

describe('point_adjustments table', () => {
  it('stores an adjustment; never updated or deleted', () => {
    const { db, adjustment } = setup()
    const id = db.insert(pointAdjustments).values(adjustment).returning().get().id
    expect(() =>
      db.update(pointAdjustments).set({ points: 6 }).where(eq(pointAdjustments.id, id)).run(),
    ).toThrow(/final/)
    expect(() => db.delete(pointAdjustments).where(eq(pointAdjustments.id, id)).run()).toThrow(
      /final/,
    )
  })

  it('points: never 0; negative is fine', () => {
    const { db, adjustment } = setup()
    expect(() =>
      db
        .insert(pointAdjustments)
        .values({ ...adjustment, points: 0 })
        .run(),
    ).toThrow(/CHECK/)
    db.insert(pointAdjustments)
      .values({ ...adjustment, points: -3 })
      .run()
  })

  it('reason: 1–1000 characters after trimming', () => {
    const { db, adjustment } = setup()
    for (const reason of ['', '   ', 'a'.repeat(1001)]) {
      expect(() =>
        db
          .insert(pointAdjustments)
          .values({ ...adjustment, reason })
          .run(),
      ).toThrow(/CHECK/)
    }
    db.insert(pointAdjustments)
      .values({ ...adjustment, reason: 'a'.repeat(1000) })
      .run()
  })

  it('a correction posts at most one adjustment', () => {
    const { db, correction, adjustment } = setup()
    const correctionId = db.insert(settlementCorrections).values(correction).returning().get().id
    db.insert(pointAdjustments)
      .values({ ...adjustment, correctionId })
      .run()
    expect(() =>
      db
        .insert(pointAdjustments)
        .values({ ...adjustment, correctionId })
        .run(),
    ).toThrow(/UNIQUE/)
  })
})
