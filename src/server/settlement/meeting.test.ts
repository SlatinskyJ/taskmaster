import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { Db } from '~/server/db'
import { auditLog, periods, settlements, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { listPeriods, rollPeriods, savePeriodDefaults } from '~/server/periods'
import { failAuditOn, family, json, must } from '~/server/tasks/testing'
import { getMeeting, settlePeriod } from './meeting'
import type { ShownTotal } from './meeting'
import { adjustment, CUTOFF, doneTask, MEETING, plus, prague, SAT, week } from './testing'

const D = DEFAULT_PERIOD_DEFAULTS
const MONDAY = prague(2026, 11, 30, 10)

/** The totals the meeting screen shows now. */
function shown(db: Db, now: Date): ShownTotal[] {
  const m = getMeeting(db, now)
  return m.period ? m.takers.map((t) => ({ takerId: t.id, total: t.total })) : []
}

const records = (db: Db) =>
  db
    .select()
    .from(settlements)
    .orderBy(asc(settlements.id))
    .all()
    .map((r) => [r.periodId, r.takerId, r.totalBefore, r.level, r.deducted, r.carryOver])

const actions = (db: Db) =>
  db
    .select({ action: auditLog.action })
    .from(auditLog)
    .orderBy(asc(auditLog.id))
    .all()
    .map((a) => a.action)
    .filter((a) => a.startsWith('settlement.') || a.startsWith('period.'))

/** Starší 130, Mladší 30 in P1 (spec example, levels 50/100). */
function example() {
  const f = week()
  doneTask(f, { score: 100, completedAt: plus(SAT, 3_600_000), earner: f.starsi })
  doneTask(f, { score: 30, completedAt: plus(SAT, 7_200_000), earner: f.starsi })
  doneTask(f, { score: 30, completedAt: plus(SAT, 7_200_000), earner: f.mladsi })
  return f
}

describe('getMeeting', () => {
  it('nothing to settle before the first roll', () => {
    expect(getMeeting(family().db, MEETING)).toEqual({ period: null })
  })

  it('getMeeting on Sunday 20:00 lists pending done before now and previews each taker', () => {
    const f = example()
    const pending = doneTask(f, {
      score: 8,
      completedAt: plus(MEETING, -60_000),
      earner: f.mladsi,
      status: 'done_unconfirmed',
    })
    const m = getMeeting(f.db, MEETING)
    expect(m).toMatchObject({
      period: {
        id: f.p1.id,
        startsAt: SAT.toISOString(),
        endsAt: MEETING.toISOString(),
        cutoffAt: CUTOFF.toISOString(),
        running: true,
        levels: { lower: 50, upper: 100 },
      },
      takers: [
        { id: f.starsi, name: 'Starší', total: 130, level: 'upper', deducted: 100, carryOver: 30 },
        { id: f.mladsi, name: 'Mladší', total: 30, level: 'none', deducted: 0, carryOver: 30 },
      ],
    })
    expect(m.period && m.pending.map((t) => t.id)).toEqual([pending])
  })

  it('pending boundary at the period end', () => {
    const f = example()
    rollPeriods(f.db, MONDAY, D)
    const before = doneTask(f, {
      score: 8,
      completedAt: plus(CUTOFF, -1),
      earner: f.mladsi,
      status: 'done_unconfirmed',
    })
    doneTask(f, { score: 8, completedAt: CUTOFF, earner: f.mladsi, status: 'done_unconfirmed' })
    const m = getMeeting(f.db, MONDAY)
    expect(m.period && m.pending.map((t) => t.id)).toEqual([before])
    expect(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MONDAY), MONDAY)).toEqual({
      ok: false,
      error: 'pending_items',
    })
  })
})

describe('settlePeriod', () => {
  it('settle on Sunday writes a record per active taker, audits each, and ends the running week', () => {
    const f = example()
    const result = must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING))
    expect(records(f.db)).toEqual([
      [f.p1.id, f.starsi, 130, 'upper', 100, 30],
      [f.p1.id, f.mladsi, 30, 'none', 0, 30],
    ])
    expect(actions(f.db)).toEqual([
      'period.created',
      'settlement.created',
      'settlement.created',
      'period.ended',
      'period.created',
    ])
    const entry = f.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'settlement.created'))
      .orderBy(asc(auditLog.id))
      .get()
    const [first] = result.records
    expect(entry).toMatchObject({
      actorKind: 'user',
      actorUserId: f.tata,
      entityType: 'settlement',
      entityId: String(first?.id),
    })
    expect(json(entry?.after)).toEqual(first)
    expect(result.period.endedAt).toEqual(MEETING)
    expect(result.next).toMatchObject({ startsAt: MEETING, cutoffAt: prague(2026, 12, 6, 23, 59) })
    expect(listPeriods(f.db).map((p) => p.endedAt)).toEqual([MEETING, null])
  })

  it('settling after a save starts the next week with the stored defaults', () => {
    const f = example()
    const defaults = { ...D, lengthDays: 14, levels: { lower: 40, upper: 80 } }
    must(savePeriodDefaults(f.db, f.admin, defaults, plus(MEETING, -3_600_000)))
    const result = must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING))
    expect(result.next).toMatchObject({
      startsAt: MEETING,
      cutoffAt: prague(2026, 12, 13, 23, 59),
      levels: { lower: 40, upper: 80 },
    })
  })

  it('late meeting: settles the ended week, total excludes completions after the cutoff, running week not ended', () => {
    const f = example()
    // Done Sunday 23:00, approved Monday 09:00: counts for P1 (spec §5.5).
    doneTask(f, {
      score: 10,
      completedAt: prague(2026, 11, 29, 23),
      earner: f.mladsi,
      updatedAt: prague(2026, 11, 30, 9),
    })
    // Exactly at the cutoff, and Monday morning: P2.
    doneTask(f, { score: 20, completedAt: CUTOFF, earner: f.mladsi })
    doneTask(f, { score: 20, completedAt: prague(2026, 11, 30, 9), earner: f.starsi })
    rollPeriods(f.db, plus(CUTOFF, 1000), D)
    const m = getMeeting(f.db, MONDAY)
    expect(m).toMatchObject({
      period: { id: f.p1.id, endsAt: CUTOFF.toISOString(), running: false },
      takers: [
        { id: f.starsi, total: 130 },
        { id: f.mladsi, total: 40 },
      ],
    })
    const result = must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MONDAY), MONDAY))
    expect(result.next).toBeNull()
    expect(records(f.db)).toEqual([
      [f.p1.id, f.starsi, 130, 'upper', 100, 30],
      [f.p1.id, f.mladsi, 40, 'none', 0, 40],
    ])
    expect(listPeriods(f.db).map((p) => p.endedAt)).toEqual([null, null])
  })

  it('next settlement: carry-over plus new points', () => {
    const f = example()
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING))
    doneTask(f, { score: 40, completedAt: prague(2026, 12, 2, 18), earner: f.starsi })
    const p2 = listPeriods(f.db)[1]
    const at = prague(2026, 12, 6, 20)
    must(settlePeriod(f.db, f.tata, p2?.id ?? 0, shown(f.db, at), at))
    expect(records(f.db).slice(2)).toEqual([
      [p2?.id, f.starsi, 70, 'lower', 50, 20],
      [p2?.id, f.mladsi, 30, 'none', 0, 30],
    ])
  })

  it.each([
    [49, 'none', 0, 49],
    [50, 'lower', 50, 0],
    [99, 'lower', 50, 49],
    [100, 'upper', 100, 0],
    [0, 'none', 0, 0],
  ])('level boundaries end to end: %i', (total, level, deducted, carry) => {
    const f = week()
    if (total > 0) doneTask(f, { score: total, completedAt: plus(SAT, 1000), earner: f.starsi })
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING))
    expect(records(f.db)[0]).toEqual([f.p1.id, f.starsi, total, level, deducted, carry])
  })

  it('refused while pending items exist before the end', () => {
    const f = example()
    doneTask(f, {
      score: 5,
      completedAt: plus(MEETING, -1),
      earner: f.starsi,
      status: 'done_unconfirmed',
    })
    expect(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING)).toEqual({
      ok: false,
      error: 'pending_items',
    })
    expect(records(f.db)).toEqual([])
    expect(listPeriods(f.db)).toHaveLength(1)
  })

  it('totals changed since the screen: totals_changed', () => {
    const f = week()
    doneTask(f, { score: 95, completedAt: plus(SAT, 1000), earner: f.starsi })
    const seen = shown(f.db, MEETING)
    // A no-approval task completed while the screen was open.
    doneTask(f, { score: 5, completedAt: plus(MEETING, 60_000), earner: f.starsi })
    const later = plus(MEETING, 120_000)
    const refused = { ok: false, error: 'totals_changed' }
    expect(settlePeriod(f.db, f.tata, f.p1.id, seen, later)).toEqual(refused)
    const now = shown(f.db, later)
    expect(settlePeriod(f.db, f.tata, f.p1.id, now.slice(1), later)).toEqual(refused)
    expect(
      settlePeriod(f.db, f.tata, f.p1.id, [...now, { takerId: f.admin, total: 0 }], later),
    ).toEqual(refused)
    expect(records(f.db)).toEqual([])
    must(settlePeriod(f.db, f.tata, f.p1.id, now, later))
  })

  it('totals swapped between takers: totals_changed', () => {
    const f = example()
    const swapped = [
      { takerId: f.starsi, total: 30 },
      { takerId: f.mladsi, total: 130 },
    ]
    expect(settlePeriod(f.db, f.tata, f.p1.id, swapped, MEETING)).toEqual({
      ok: false,
      error: 'totals_changed',
    })
  })

  it('refused early end rolls everything back', () => {
    const f = example()
    const stale = plus(CUTOFF, -1)
    const seen = shown(f.db, stale)
    // The scheduler already started P2; the confirm's clock was read just before the cutoff.
    rollPeriods(f.db, CUTOFF, D)
    expect(settlePeriod(f.db, f.tata, f.p1.id, seen, stale)).toEqual({
      ok: false,
      error: 'not_running',
    })
    expect(records(f.db)).toEqual([])
    expect(listPeriods(f.db).map((p) => p.endedAt)).toEqual([null, null])
  })

  it('second settle is already_settled', () => {
    const f = example()
    const seen = shown(f.db, MEETING)
    must(settlePeriod(f.db, f.tata, f.p1.id, seen, MEETING))
    expect(settlePeriod(f.db, f.tata, f.p1.id, seen, plus(MEETING, 1000))).toEqual({
      ok: false,
      error: 'already_settled',
    })
    expect(records(f.db)).toHaveLength(2)
  })

  it('a stale period id is wrong_period', () => {
    const f = example()
    // Screen opened Sun 23:58 for P1, the roll ran at 23:59, confirmed after: P1 is still the
    // week to settle (the oldest ended one), so it settles.
    const seen = shown(f.db, prague(2026, 11, 29, 23, 58))
    rollPeriods(f.db, CUTOFF, D)
    must(settlePeriod(f.db, f.tata, f.p1.id, seen, plus(CUTOFF, 30_000)))
    // Two weeks later with P2 unsettled: a confirm for P3 is not the week to settle.
    const at = prague(2026, 12, 8, 10)
    rollPeriods(f.db, at, D)
    const [, p2, p3] = listPeriods(f.db)
    expect(settlePeriod(f.db, f.tata, p3?.id ?? 0, shown(f.db, at), at)).toEqual({
      ok: false,
      error: 'wrong_period',
    })
    expect(settlePeriod(f.db, f.tata, 999, shown(f.db, at), at)).toEqual({
      ok: false,
      error: 'not_found',
    })
    must(settlePeriod(f.db, f.tata, p2?.id ?? 0, shown(f.db, at), at))
  })

  it('nothing to settle once every week is settled and the new one just started', () => {
    const f = example()
    const result = must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING))
    expect(getMeeting(f.db, MEETING)).toEqual({ period: null })
    expect(settlePeriod(f.db, f.tata, result.next?.id ?? 0, [], MEETING)).toEqual({
      ok: false,
      error: 'nothing_to_settle',
    })
  })

  it("a taker, the admin, or an unknown user can't settle", () => {
    const f = example()
    const seen = shown(f.db, MEETING)
    for (const id of [f.starsi, f.admin, 999]) {
      expect(settlePeriod(f.db, id, f.p1.id, seen, MEETING)).toEqual({
        ok: false,
        error: 'not_a_giver',
      })
    }
    expect(records(f.db)).toEqual([])
  })

  it('with no takers there is nothing to settle and no week is ended', () => {
    const db = createTestDb()
    const user = (username: string, role: 'admin' | 'giver') =>
      db
        .insert(users)
        .values({
          username,
          displayName: username,
          role,
          createdAt: SAT.toISOString(),
          updatedAt: SAT.toISOString(),
        })
        .returning()
        .get().id
    const admin = user('admin', 'admin')
    const tata = user('tata', 'giver')
    rollPeriods(db, SAT, D)
    const [p1] = listPeriods(db)
    expect(getMeeting(db, MEETING)).toEqual({ period: null })
    expect(settlePeriod(db, admin, p1?.id ?? 0, [], MEETING)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(settlePeriod(db, tata, p1?.id ?? 0, [], MEETING)).toEqual({
      ok: false,
      error: 'no_takers',
    })
    expect(listPeriods(db).map((p) => p.endedAt)).toEqual([null])
  })

  it('a failed audit write rolls back every record and the early end', () => {
    for (const action of ['settlement.created', 'period.ended']) {
      const f = example()
      const seen = shown(f.db, MEETING)
      failAuditOn(f.db, action)
      expect(() => settlePeriod(f.db, f.tata, f.p1.id, seen, MEETING)).toThrow(/audit down/)
      expect(records(f.db)).toEqual([])
      expect(
        f.db
          .select()
          .from(periods)
          .all()
          .map((p) => p.endedAt),
      ).toEqual([null])
    }
  })
})

describe('adjustments at the meeting (#48)', () => {
  it("an ended week's total holds an adjustment made inside it once; a later one waits", () => {
    const f = week()
    doneTask(f, { score: 40, completedAt: plus(SAT, 3_600_000), earner: f.starsi })
    adjustment(f, f.starsi, 15, plus(SAT, 7_200_000))
    adjustment(f, f.starsi, 2, plus(CUTOFF, 60_000))
    rollPeriods(f.db, MONDAY, D)
    const m = getMeeting(f.db, MONDAY)
    if (!m.period) throw new Error('nothing to settle')
    expect(m.takers.find((t) => t.id === f.starsi)).toMatchObject({ total: 55, level: 'lower' })
  })
})
