import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { ALL_FEATURES, FEATURE_KEYS, NO_FEATURES } from '~/lib/features'
import { auditLog, featureFlags } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { family } from '~/server/tasks/testing'
import { getFlags, parseSwitchInput, setSwitch, setSwitchesIn } from './flags'

describe('NO_FEATURES and ALL_FEATURES', () => {
  it('hold every switch, all off and all on', () => {
    expect(NO_FEATURES).toStrictEqual(Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])))
    expect(ALL_FEATURES).toStrictEqual(Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])))
  })
})

describe('getFlags', () => {
  it('reads the values the migrations leave: on since the release (0022), disputes off (0024), settleLastDay on (0027), passwordChange off (0028), bidRefusals off (0029), approveAnywhere off (0030), reopenBidding off (0031), choreBidding off (0032), openRows off (0033), descriptions off (0037), weekPlan off (0039), suggestions off (0040)', () => {
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
      weekPlan: false,
      suggestions: false,
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
      weekPlan: false,
      suggestions: false,
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
      weekPlan: true,
      suggestions: true,
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
      weekPlan: false,
      suggestions: false,
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

describe('setSwitch (#296)', () => {
  const AT = new Date('2026-11-26T10:00:00.000Z')
  const MIGRATED = getFlags(createTestDb())
  const rows = (db: ReturnType<typeof createTestDb>) =>
    db
      .select()
      .from(auditLog)
      .all()
      .map((r) => [r.action, r.actorKind, r.actorUserId, r.entityType, r.entityId, r.at])

  it('turns a switch on and logs it with the admin as actor', () => {
    const { db, admin } = family()
    expect(setSwitch(db, admin, 'disputes', true, AT)).toStrictEqual({ changed: true })
    expect(getFlags(db)).toStrictEqual({ ...MIGRATED, disputes: true })
    expect(rows(db)).toEqual([
      ['feature.switched', 'user', admin, 'feature', 'disputes', AT.toISOString()],
    ])
    const [entry] = db.select().from(auditLog).all()
    expect(JSON.parse(entry?.before ?? 'null')).toEqual({ enabled: false })
    expect(JSON.parse(entry?.after ?? 'null')).toEqual({ enabled: true })
  })

  it('creates the row of a switch with no row', () => {
    const { db, admin } = family()
    db.delete(featureFlags).where(eq(featureFlags.key, 'weekPlan')).run()
    expect(setSwitch(db, admin, 'weekPlan', true, AT)).toStrictEqual({ changed: true })
    expect(db.select().from(featureFlags).where(eq(featureFlags.key, 'weekPlan')).get()).toEqual({
      key: 'weekPlan',
      enabled: true,
    })
    const [entry] = db.select().from(auditLog).all()
    expect(JSON.parse(entry?.before ?? 'null')).toEqual({ enabled: false })
  })

  it('turns a switch off', () => {
    const { db, admin } = family()
    expect(setSwitch(db, admin, 'recurring', false, AT)).toStrictEqual({ changed: true })
    expect(getFlags(db)).toStrictEqual({ ...MIGRATED, recurring: false })
    expect(rows(db)).toEqual([
      ['feature.switched', 'user', admin, 'feature', 'recurring', AT.toISOString()],
    ])
    const [entry] = db.select().from(auditLog).all()
    expect(JSON.parse(entry?.before ?? 'null')).toEqual({ enabled: true })
    expect(JSON.parse(entry?.after ?? 'null')).toEqual({ enabled: false })
  })

  it('writes nothing when the switch already has that value', () => {
    const { db, admin } = family()
    expect(setSwitch(db, admin, 'recurring', true, AT)).toStrictEqual({ changed: false })
    expect(db.select().from(auditLog).all()).toHaveLength(0)
    expect(getFlags(db)).toStrictEqual(MIGRATED)
  })

  it('rolls the switch back when the audit write fails', () => {
    const { db, admin } = family()
    db.run(
      sql`CREATE TRIGGER boom BEFORE INSERT ON audit_log WHEN NEW.action = 'feature.switched' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    )
    expect(() => setSwitch(db, admin, 'disputes', true, AT)).toThrow('boom')
    expect(getFlags(db).disputes).toBe(false)
  })
})

describe('parseSwitchInput (#296)', () => {
  it('accepts a known key and a boolean', () => {
    expect(parseSwitchInput({ key: 'log', enabled: false })).toStrictEqual({
      key: 'log',
      enabled: false,
    })
    expect(parseSwitchInput({ key: 'weekPlan', enabled: true, extra: 1 })).toStrictEqual({
      key: 'weekPlan',
      enabled: true,
    })
  })

  it('refuses an unknown key, a non-boolean value and no object', () => {
    expect(() => parseSwitchInput({ key: 'nope', enabled: true })).toThrow('invalid_switch')
    expect(() => parseSwitchInput({ key: 'log', enabled: 1 })).toThrow('invalid_switch')
    expect(() => parseSwitchInput({ key: 'toString', enabled: true })).toThrow('invalid_switch')
    expect(() => parseSwitchInput(null)).toThrow('invalid_switch')
    expect(() => parseSwitchInput('log')).toThrow('invalid_switch')
  })
})
