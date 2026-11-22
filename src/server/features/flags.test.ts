import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { NO_FEATURES } from '~/lib/features'
import { auditLog, featureFlags } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { getFlags, switchOnIn } from './flags'

describe('getFlags', () => {
  it('reads the launch values the migration seeds: everything off', () => {
    expect(getFlags(createTestDb())).toEqual({
      recurring: false,
      log: false,
      week: false,
      meeting: false,
      periodProposals: false,
    })
    expect(
      createTestDb()
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, 'periodProposals'))
        .get(),
    ).toEqual({ key: 'periodProposals', enabled: false })
  })

  it('reads a switch turned on by hand in the database', () => {
    const db = createTestDb()
    db.run(sql`UPDATE feature_flags SET enabled = 1 WHERE key = 'recurring'`)
    expect(getFlags(db)).toEqual({ ...NO_FEATURES, recurring: true })
  })

  it('reads a switch with no row as off', () => {
    const db = createTestDb()
    db.update(featureFlags).set({ enabled: true }).run()
    db.delete(featureFlags).where(eq(featureFlags.key, 'week')).run()
    expect(getFlags(db)).toEqual({
      recurring: true,
      log: true,
      week: false,
      meeting: true,
      periodProposals: true,
    })
  })

  it('ignores a row for a switch the code does not know', () => {
    const db = createTestDb()
    db.insert(featureFlags).values({ key: 'teleport', enabled: true }).run()
    expect(getFlags(db)).toEqual(NO_FEATURES)
  })

  it('refuses a hand edit that is not 0 or 1', () => {
    const db = createTestDb()
    // The raw driver, as the sqlite3 CLI would run it (drizzle wraps the error).
    expect(() =>
      db.$client.exec("UPDATE feature_flags SET enabled = 'true' WHERE key = 'log'"),
    ).toThrow(/CHECK constraint failed/)
    expect(getFlags(db).log).toBe(false)
  })
})

describe('switchOnIn (#183)', () => {
  const AT = new Date('2026-11-17T10:00:00.000Z')

  it('turns the listed switches on and logs each', () => {
    const db = createTestDb()
    db.transaction((tx) => {
      switchOnIn(tx, ['week', 'meeting'], AT)
    })
    expect(getFlags(db)).toEqual({ ...NO_FEATURES, week: true, meeting: true })
    const log = db.select().from(auditLog).all()
    expect(log.map((r) => [r.action, r.actorKind, r.entityType, r.entityId, r.at])).toEqual([
      ['feature.switched', 'system', 'feature', 'week', AT.toISOString()],
      ['feature.switched', 'system', 'feature', 'meeting', AT.toISOString()],
    ])
    expect(JSON.parse(log[0]?.before ?? 'null')).toEqual({ enabled: false })
    expect(JSON.parse(log[0]?.after ?? 'null')).toEqual({ enabled: true })
  })

  it('a switch already on writes nothing', () => {
    const db = createTestDb()
    db.transaction((tx) => {
      switchOnIn(tx, ['log'], AT)
    })
    db.transaction((tx) => {
      switchOnIn(tx, ['log'], AT)
    })
    expect(db.select().from(auditLog).all()).toHaveLength(1)
  })

  it('a missing row is created', () => {
    const db = createTestDb()
    db.delete(featureFlags).where(eq(featureFlags.key, 'log')).run()
    db.transaction((tx) => {
      switchOnIn(tx, ['log'], AT)
    })
    expect(getFlags(db).log).toBe(true)
  })

  it('rolls back when the audit write fails', () => {
    const db = createTestDb()
    db.run(
      sql`CREATE TRIGGER boom BEFORE INSERT ON audit_log WHEN NEW.action = 'feature.switched' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    )
    expect(() => {
      db.transaction((tx) => {
        switchOnIn(tx, ['week'], AT)
      })
    }).toThrow('boom')
    expect(getFlags(db)).toEqual(NO_FEATURES)
  })
})
