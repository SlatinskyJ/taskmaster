import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { fromPragueWallTime } from '~/domain/dates'
import type { PeriodDefaults } from '~/domain'
import type { Actor } from '~/server/audit'
import type { Db } from '~/server/db'
import { auditLog, periods } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { failAuditOn } from '~/server/tasks/testing'
import {
  currentLevels,
  currentPeriod,
  endRunningPeriod,
  listPeriods,
  periodAtInstant,
  rollPeriods,
} from './periods'

const D = DEFAULT_PERIOD_DEFAULTS
const prague = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  fromPragueWallTime({ year, month, day, hour, minute })
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms)
const HOUR = 3_600_000

const SAT = prague(2026, 11, 21, 20) // first roll
const CUTOFF = prague(2026, 11, 29, 23, 59) // first period's cutoff
const MEETING = prague(2026, 11, 29, 20)
const DAD: Actor = { kind: 'user', userId: 1 }

const audits = (db: Db) =>
  db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityType, 'period'))
    .orderBy(asc(auditLog.id))
    .all()
    .map((a) => ({
      action: a.action,
      actorKind: a.actorKind,
      actorUserId: a.actorUserId,
      entityId: a.entityId,
      before: a.before === null ? null : (JSON.parse(a.before) as unknown),
      after: JSON.parse(a.after ?? 'null') as Record<string, unknown>,
    }))

function rolled() {
  const db = createTestDb()
  const [first] = rollPeriods(db, SAT, D)
  if (!first) throw new Error('no first period')
  return { db, first }
}

/** Ends the running period inside a transaction, as #44's settlement will. */
const endAt = (db: Db, periodId: number, now: Date, defaults: PeriodDefaults = D) =>
  db.transaction((tx) => endRunningPeriod(tx, DAD, periodId, now, defaults))

describe('rollPeriods (spec §5.8)', () => {
  it('the first roll creates the first period, ending Sun 29 Nov 23:59', () => {
    const { db, first } = rolled()
    expect(first).toMatchObject({ startsAt: SAT, cutoffAt: CUTOFF, endedAt: null })
    expect(first.levels).toEqual({ lower: 50, upper: 100 })
    expect(audits(db)).toEqual([
      {
        action: 'period.created',
        actorKind: 'system',
        actorUserId: null,
        entityId: String(first.id),
        before: null,
        after: {
          startsAt: SAT.toISOString(),
          cutoffAt: CUTOFF.toISOString(),
          levels: { lower: 50, upper: 100 },
          cause: 'first',
        },
      },
    ])
  })

  it('a second roll is a no-op', () => {
    const { db } = rolled()
    expect(rollPeriods(db, SAT, D)).toEqual([])
    expect(rollPeriods(db, plus(SAT, HOUR), D)).toEqual([])
    expect(listPeriods(db)).toHaveLength(1)
    expect(audits(db)).toHaveLength(1)
  })

  it('rolls exactly at the cutoff instant, not a millisecond before', () => {
    const { db } = rolled()
    expect(rollPeriods(db, plus(CUTOFF, -1), D)).toEqual([])
    const [next] = rollPeriods(db, CUTOFF, D)
    expect(next).toMatchObject({ startsAt: CUTOFF, cutoffAt: prague(2026, 12, 6, 23, 59) })
  })

  it('catches up several missed cutoffs in one roll, with one audit entry each', () => {
    const { db } = rolled()
    const created = rollPeriods(db, prague(2026, 12, 14, 12), D)
    expect(created.map((p) => [p.startsAt, p.cutoffAt])).toEqual([
      [prague(2026, 11, 29, 23, 59), prague(2026, 12, 6, 23, 59)],
      [prague(2026, 12, 6, 23, 59), prague(2026, 12, 13, 23, 59)],
      [prague(2026, 12, 13, 23, 59), prague(2026, 12, 20, 23, 59)],
    ])
    const entries = audits(db).slice(1)
    expect(entries).toHaveLength(3)
    entries.forEach((e, i) => {
      expect(e).toMatchObject({
        action: 'period.created',
        actorKind: 'system',
        entityId: String(created[i]?.id),
      })
      expect(e.after).toMatchObject({
        cause: 'cutoff',
        startsAt: created[i]?.startsAt.toISOString(),
      })
    })
  })

  it('a failed audit write rolls the roll back', () => {
    const db = createTestDb()
    failAuditOn(db, 'period.created')
    expect(() => rollPeriods(db, SAT, D)).toThrow(/audit down/)
    expect(listPeriods(db)).toEqual([])
  })

  it('uses the defaults it is given', () => {
    const db = createTestDb()
    const [first] = rollPeriods(db, SAT, { ...D, levels: { lower: 30, upper: 60 } })
    expect(first?.levels).toEqual({ lower: 30, upper: 60 })
  })
})

describe('reading periods', () => {
  it('periodAtInstant: the cutoff instant belongs to the new period', () => {
    const { db, first } = rolled()
    const [next] = rollPeriods(db, CUTOFF, D)
    expect(periodAtInstant(db, plus(CUTOFF, -1))?.id).toBe(first.id)
    expect(periodAtInstant(db, CUTOFF)?.id).toBe(next?.id)
    expect(periodAtInstant(db, plus(SAT, -1))).toBeUndefined()
  })

  it('currentPeriod: none before the first roll and between a cutoff and its roll', () => {
    const db = createTestDb()
    expect(currentPeriod(db, SAT)).toBeUndefined()
    rollPeriods(db, SAT, D)
    expect(currentPeriod(db, plus(CUTOFF, -1))?.startsAt).toEqual(SAT)
    expect(currentPeriod(db, CUTOFF)).toBeUndefined()
  })

  it('currentLevels: the running period levels, else the given defaults', () => {
    const db = createTestDb()
    const other = { ...D, levels: { lower: 30, upper: 60 } }
    expect(currentLevels(db, SAT, other)).toEqual({ lower: 30, upper: 60 })
    db.insert(periods)
      .values({
        startsAt: SAT.toISOString(),
        cutoffAt: CUTOFF.toISOString(),
        endedAt: null,
        lowerLevel: 40,
        upperLevel: 90,
        createdAt: SAT.toISOString(),
      })
      .run()
    expect(currentLevels(db, plus(SAT, HOUR), other)).toEqual({ lower: 40, upper: 90 })
  })
})

describe('endRunningPeriod: settling ends the period (spec §5.8)', () => {
  it('ends the running period now and starts the next, to the next Sunday 23:59', () => {
    const { db, first } = rolled()
    const result = endAt(db, first.id, MEETING)
    if (!result.ok) throw new Error(result.error)
    const { ended, next } = result.value
    expect(ended).toMatchObject({ id: first.id, endedAt: MEETING, cutoffAt: CUTOFF })
    expect(next).toMatchObject({ startsAt: MEETING, cutoffAt: prague(2026, 12, 6, 23, 59) })
    expect(listPeriods(db).map((p) => p.endedAt)).toEqual([MEETING, null])
    expect(audits(db).slice(1)).toEqual([
      {
        action: 'period.ended',
        actorKind: 'user',
        actorUserId: 1,
        entityId: String(first.id),
        before: { endedAt: null },
        after: { endedAt: MEETING.toISOString() },
      },
      {
        action: 'period.created',
        actorKind: 'user',
        actorUserId: 1,
        entityId: String(next.id),
        before: null,
        after: {
          startsAt: MEETING.toISOString(),
          cutoffAt: prague(2026, 12, 6, 23, 59).toISOString(),
          levels: { lower: 50, upper: 100 },
          cause: 'settled',
        },
      },
    ])
  })

  it('after an early end, currentPeriod and currentLevels are the new period', () => {
    const db = createTestDb()
    db.insert(periods)
      .values({
        startsAt: SAT.toISOString(),
        cutoffAt: CUTOFF.toISOString(),
        endedAt: null,
        lowerLevel: 40,
        upperLevel: 90,
        createdAt: SAT.toISOString(),
      })
      .run()
    const [settled] = listPeriods(db)
    if (!settled) throw new Error('no period')
    const result = endAt(db, settled.id, MEETING)
    if (!result.ok) throw new Error(result.error)
    const nextId = result.value.next.id
    expect(currentPeriod(db, plus(MEETING, -1))?.id).toBe(settled.id)
    expect(currentLevels(db, plus(MEETING, -1), D)).toEqual({ lower: 40, upper: 90 })
    for (const at of [MEETING, plus(MEETING, HOUR)]) {
      expect(currentPeriod(db, at)?.id).toBe(nextId)
      expect(currentLevels(db, at, D)).toEqual({ lower: 50, upper: 100 })
    }
  })

  it('refuses an unknown period', () => {
    const { db } = rolled()
    expect(endAt(db, 999, MEETING)).toEqual({ ok: false, error: 'not_found' })
  })

  it('a retried confirm a second later does not end the new period', () => {
    const { db, first } = rolled()
    expect(endAt(db, first.id, MEETING).ok).toBe(true)
    const before = audits(db).length
    expect(endAt(db, first.id, plus(MEETING, 1000))).toEqual({ ok: false, error: 'not_running' })
    expect(listPeriods(db).map((p) => p.endedAt)).toEqual([MEETING, null])
    expect(audits(db)).toHaveLength(before)
  })

  it('a confirm after the cutoff roll does not end the new period', () => {
    const { db, first } = rolled()
    rollPeriods(db, CUTOFF, D)
    const before = audits(db).length
    expect(endAt(db, first.id, plus(CUTOFF, 30_000))).toEqual({ ok: false, error: 'not_running' })
    expect(listPeriods(db).map((p) => p.endedAt)).toEqual([null, null])
    expect(audits(db)).toHaveLength(before)
  })

  it('the roll after an early end does nothing until the new cutoff', () => {
    const { db, first } = rolled()
    endAt(db, first.id, MEETING)
    expect(rollPeriods(db, CUTOFF, D)).toEqual([])
    expect(rollPeriods(db, prague(2026, 12, 6, 23, 59), D)).toHaveLength(1)
  })

  it('a failed audit write rolls the early end back', () => {
    for (const action of ['period.ended', 'period.created']) {
      const { db, first } = rolled()
      failAuditOn(db, action)
      expect(() => endAt(db, first.id, MEETING)).toThrow(/audit down/)
      expect(listPeriods(db).map((p) => p.endedAt)).toEqual([null])
    }
  })
})
