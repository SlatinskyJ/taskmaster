import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { ALL_FEATURES, FEATURE_KEYS, NO_FEATURES } from '~/lib/features'
import { auditLog, featureFlags } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { getFlags, setSwitchesIn } from './flags'

describe('NO_FEATURES and ALL_FEATURES', () => {
  it('hold every switch, all off and all on', () => {
    expect(NO_FEATURES).toStrictEqual(Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])))
    expect(ALL_FEATURES).toStrictEqual(Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])))
  })
})

describe('getFlags', () => {
  it('reads the values the migrations leave: on since the release (0022), disputes off (0024), settleLastDay on (0027), passwordChange off (0028), bidRefusals off (0029), approveAnywhere off (0030), reopenBidding off (0031), choreBidding off (0032), openRows off (0033), descriptions off (0035)', () => {
    expect(getFlags(createTestDb())).toEqual({
      recurring: true,
      log: true,
      week: true,
      meeting: true,
      periodProposals: true,
      disputes: false,
      settleLastDay: true,
      passwordChange: false,
      bidRefusals: false,
      approveAnywhere: false,
      reopenBidding: false,
      choreBidding: false,
      openRows: false,
      descriptions: false,
    })
    expect(
      createTestDb()
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.key, 'periodProposals'))
        .get(),
    ).toEqual({ key: 'periodProposals', enabled: true })
  })

  it('reads a switch turned off by hand in the database', () => {
    const db = createTestDb()
    db.run(sql`UPDATE feature_flags SET enabled = 0 WHERE key = 'recurring'`)
    expect(getFlags(db)).toEqual({
      ...ALL_FEATURES,
      recurring: false,
      disputes: false,
      passwordChange: false,
      bidRefusals: false,
      approveAnywhere: false,
      reopenBidding: false,
      choreBidding: false,
      openRows: false,
      descriptions: false,
    })
  })

  it('an empty table reads every switch as off', () => {
    const db = createTestDb()
    db.delete(featureFlags).run()
    expect(Object.values(getFlags(db)).every((on) => !on)).toBe(true)
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
      disputes: true,
      settleLastDay: true,
      passwordChange: true,
      bidRefusals: true,
      approveAnywhere: true,
      reopenBidding: true,
      choreBidding: true,
      openRows: true,
      descriptions: true,
    })
  })

  it('ignores a row for a switch the code does not know', () => {
    const db = createTestDb()
    db.insert(featureFlags).values({ key: 'teleport', enabled: false }).run()
    expect(getFlags(db)).toEqual({
      ...ALL_FEATURES,
      disputes: false,
      passwordChange: false,
      bidRefusals: false,
      approveAnywhere: false,
      reopenBidding: false,
      choreBidding: false,
      openRows: false,
      descriptions: false,
    })
  })

  it('refuses a hand edit that is not 0 or 1', () => {
    const db = createTestDb()
    // The raw driver, as the sqlite3 CLI would run it (drizzle wraps the error).
    expect(() =>
      db.$client.exec("UPDATE feature_flags SET enabled = 'true' WHERE key = 'log'"),
    ).toThrow(/CHECK constraint failed/)
    expect(getFlags(db).log).toBe(true)
  })
})

describe('setSwitchesIn (#183)', () => {
  const AT = new Date('2026-11-17T10:00:00.000Z')
  /** A database with every switch off, as before the release migration. */
  const allOff = () => {
    const db = createTestDb()
    db.update(featureFlags).set({ enabled: false }).run()
    return db
  }

  it('turns the listed switches on and logs each', () => {
    const db = allOff()
    db.transaction((tx) => {
      setSwitchesIn(tx, ['week', 'meeting'], AT)
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
    const db = allOff()
    db.transaction((tx) => {
      setSwitchesIn(tx, ['log'], AT)
    })
    db.transaction((tx) => {
      setSwitchesIn(tx, ['log'], AT)
    })
    expect(db.select().from(auditLog).all()).toHaveLength(1)
  })

  it('turns the switches it does not list off and logs each', () => {
    const db = createTestDb()
    db.transaction((tx) => {
      setSwitchesIn(tx, ['recurring', 'log'], AT)
    })
    expect(getFlags(db)).toEqual({ ...NO_FEATURES, recurring: true, log: true })
    const log = db.select().from(auditLog).all()
    expect(log.map((r) => r.entityId)).toEqual([
      'week',
      'meeting',
      'periodProposals',
      'settleLastDay',
    ])
    expect(JSON.parse(log[0]?.before ?? 'null')).toEqual({ enabled: true })
    expect(JSON.parse(log[0]?.after ?? 'null')).toEqual({ enabled: false })
  })

  it('an empty list turns every switch off', () => {
    const db = createTestDb()
    db.transaction((tx) => {
      setSwitchesIn(tx, [], AT)
    })
    expect(getFlags(db)).toEqual(NO_FEATURES)
  })

  it('a missing row is created', () => {
    const db = allOff()
    db.delete(featureFlags).where(eq(featureFlags.key, 'log')).run()
    db.transaction((tx) => {
      setSwitchesIn(tx, ['log'], AT)
    })
    expect(getFlags(db).log).toBe(true)
  })

  it('rolls back when the audit write fails', () => {
    const db = allOff()
    db.run(
      sql`CREATE TRIGGER boom BEFORE INSERT ON audit_log WHEN NEW.action = 'feature.switched' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    )
    expect(() => {
      db.transaction((tx) => {
        setSwitchesIn(tx, ['week'], AT)
      })
    }).toThrow('boom')
    expect(getFlags(db)).toEqual(NO_FEATURES)
  })
})
