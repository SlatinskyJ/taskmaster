import { describe, expect, it } from 'vitest'
import { periods } from './schema'
import { createTestDb } from './testing'

// The DB backs up the domain's period rules (spec §5.8): a period row that makes no sense can't
// be stored, whatever code writes it.
const valid = {
  startsAt: '2026-11-22T22:59:00.000Z',
  cutoffAt: '2026-11-29T22:59:00.000Z',
  endedAt: null,
  lowerLevel: 50,
  upperLevel: 100,
  createdAt: '2026-11-22T22:59:00.000Z',
}

describe('periods table', () => {
  it('stores a valid period, and one that ended early', () => {
    const db = createTestDb()
    db.insert(periods).values(valid).run()
    db.insert(periods)
      .values({
        ...valid,
        startsAt: '2026-11-29T22:59:00.000Z',
        cutoffAt: '2026-12-06T22:59:00.000Z',
        endedAt: '2026-12-06T19:00:00.000Z',
      })
      .run()
    expect(db.select().from(periods).all()).toHaveLength(2)
  })

  it('refuses a cutoff at or before the start', () => {
    const db = createTestDb()
    expect(() =>
      db
        .insert(periods)
        .values({ ...valid, cutoffAt: valid.startsAt })
        .run(),
    ).toThrow(/periods_span_check/)
  })

  it('refuses levels below 1 or lower above upper; lower = upper is fine', () => {
    const db = createTestDb()
    expect(() =>
      db
        .insert(periods)
        .values({ ...valid, lowerLevel: 0 })
        .run(),
    ).toThrow(/periods_levels_check/)
    expect(() =>
      db
        .insert(periods)
        .values({ ...valid, lowerLevel: 60, upperLevel: 50 })
        .run(),
    ).toThrow(/periods_levels_check/)
    db.insert(periods)
      .values({ ...valid, lowerLevel: 50, upperLevel: 50 })
      .run()
  })

  it('refuses an early end at the start or at/after the cutoff', () => {
    const db = createTestDb()
    for (const endedAt of [valid.startsAt, valid.cutoffAt, '2026-11-30T10:00:00.000Z']) {
      expect(() =>
        db
          .insert(periods)
          .values({ ...valid, endedAt })
          .run(),
      ).toThrow(/periods_ended_check/)
    }
  })

  it('two periods never start at the same instant', () => {
    const db = createTestDb()
    db.insert(periods).values(valid).run()
    expect(() => db.insert(periods).values(valid).run()).toThrow(/UNIQUE/)
  })
})
