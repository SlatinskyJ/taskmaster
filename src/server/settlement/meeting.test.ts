import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { Db } from '~/server/db'
import { auditLog, featureFlags, periods, settlements, tasks, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { listPeriods, rollPeriods, savePeriodDefaults } from '~/server/periods'
import { approveTemplateScore, createTemplate } from '~/server/templates'
import { T0, failAuditOn, family, json, must } from '~/server/tasks/testing'
import { getMeeting, lastSettledAt, settledOnPragueDay, settlePeriod, weekWaiting } from './meeting'
import type { ShownTotal } from './meeting'
import { adjustment, CUTOFF, doneTask, MEETING, plus, prague, SAT, week } from './testing'

const D = DEFAULT_PERIOD_DEFAULTS
const MONDAY = prague(2026, 11, 30, 10)

/** The totals the meeting screen shows now. */
function shown(db: Db, now: Date): ShownTotal[] {
  const m = getMeeting(db, now, false)
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
    expect(getMeeting(family().db, MEETING, false)).toEqual({
      period: null,
      runningCutoffAt: null,
      settledToday: false,
    })
  })

  it('getMeeting on Sunday 20:00 lists pending done before now and previews each taker', () => {
    const f = example()
    const pending = doneTask(f, {
      score: 8,
      completedAt: plus(MEETING, -60_000),
      earner: f.mladsi,
      status: 'done_unconfirmed',
    })
    const m = getMeeting(f.db, MEETING, false)
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

  it('pending items carry their description only with the switch on (#207)', () => {
    const f = example()
    const id = doneTask(f, {
      score: 8,
      completedAt: plus(MEETING, -60_000),
      earner: f.mladsi,
      status: 'done_unconfirmed',
    })
    f.db.update(tasks).set({ description: 'I kufr.' }).where(eq(tasks.id, id)).run()
    const first = () => {
      const m = getMeeting(f.db, MEETING, false)
      return m.period ? m.pending[0]?.description : 'no period'
    }
    expect(first()).toBeNull()
    f.db
      .update(featureFlags)
      .set({ enabled: true })
      .where(eq(featureFlags.key, 'descriptions'))
      .run()
    expect(first()).toBe('I kufr.')
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
    const m = getMeeting(f.db, MONDAY, false)
    expect(m.period && m.pending.map((t) => t.id)).toEqual([before])
    expect(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MONDAY), MONDAY, false)).toEqual({
      ok: false,
      error: 'pending_items',
    })
  })
})

describe('settlePeriod', () => {
  it('settle on Sunday writes a record per active taker, audits each, and ends the running week', () => {
    const f = example()
    const result = must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
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
    const result = must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
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
    const m = getMeeting(f.db, MONDAY, false)
    expect(m).toMatchObject({
      period: { id: f.p1.id, endsAt: CUTOFF.toISOString(), running: false },
      takers: [
        { id: f.starsi, total: 130 },
        { id: f.mladsi, total: 40 },
      ],
    })
    const result = must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MONDAY), MONDAY, false))
    expect(result.next).toBeNull()
    expect(records(f.db)).toEqual([
      [f.p1.id, f.starsi, 130, 'upper', 100, 30],
      [f.p1.id, f.mladsi, 40, 'none', 0, 40],
    ])
    expect(listPeriods(f.db).map((p) => p.endedAt)).toEqual([null, null])
  })

  it('next settlement: carry-over plus new points', () => {
    const f = example()
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
    doneTask(f, { score: 40, completedAt: prague(2026, 12, 2, 18), earner: f.starsi })
    const p2 = listPeriods(f.db)[1]
    const at = prague(2026, 12, 6, 20)
    must(settlePeriod(f.db, f.tata, p2?.id ?? 0, shown(f.db, at), at, false))
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
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
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
    expect(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false)).toEqual({
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
    expect(settlePeriod(f.db, f.tata, f.p1.id, seen, later, false)).toEqual(refused)
    const now = shown(f.db, later)
    expect(settlePeriod(f.db, f.tata, f.p1.id, now.slice(1), later, false)).toEqual(refused)
    expect(
      settlePeriod(f.db, f.tata, f.p1.id, [...now, { takerId: f.admin, total: 0 }], later, false),
    ).toEqual(refused)
    expect(records(f.db)).toEqual([])
    must(settlePeriod(f.db, f.tata, f.p1.id, now, later, false))
  })

  it('totals swapped between takers: totals_changed', () => {
    const f = example()
    const swapped = [
      { takerId: f.starsi, total: 30 },
      { takerId: f.mladsi, total: 130 },
    ]
    expect(settlePeriod(f.db, f.tata, f.p1.id, swapped, MEETING, false)).toEqual({
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
    expect(settlePeriod(f.db, f.tata, f.p1.id, seen, stale, false)).toEqual({
      ok: false,
      error: 'not_running',
    })
    expect(records(f.db)).toEqual([])
    expect(listPeriods(f.db).map((p) => p.endedAt)).toEqual([null, null])
  })

  it('second settle is already_settled', () => {
    const f = example()
    const seen = shown(f.db, MEETING)
    must(settlePeriod(f.db, f.tata, f.p1.id, seen, MEETING, false))
    expect(settlePeriod(f.db, f.tata, f.p1.id, seen, plus(MEETING, 1000), false)).toEqual({
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
    must(settlePeriod(f.db, f.tata, f.p1.id, seen, plus(CUTOFF, 30_000), false))
    // Two weeks later with P2 unsettled: a confirm for P3 is not the week to settle.
    const at = prague(2026, 12, 8, 10)
    rollPeriods(f.db, at, D)
    const [, p2, p3] = listPeriods(f.db)
    expect(settlePeriod(f.db, f.tata, p3?.id ?? 0, shown(f.db, at), at, false)).toEqual({
      ok: false,
      error: 'wrong_period',
    })
    expect(settlePeriod(f.db, f.tata, 999, shown(f.db, at), at, false)).toEqual({
      ok: false,
      error: 'not_found',
    })
    must(settlePeriod(f.db, f.tata, p2?.id ?? 0, shown(f.db, at), at, false))
  })

  it('nothing to settle once every week is settled and the new one just started', () => {
    const f = example()
    const result = must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
    expect(getMeeting(f.db, MEETING, false)).toEqual({
      period: null,
      runningCutoffAt: null,
      settledToday: true,
    })
    expect(settlePeriod(f.db, f.tata, result.next?.id ?? 0, [], MEETING, false)).toEqual({
      ok: false,
      error: 'nothing_to_settle',
    })
  })

  it("a taker, the admin, or an unknown user can't settle", () => {
    const f = example()
    const seen = shown(f.db, MEETING)
    for (const id of [f.starsi, f.admin, 999]) {
      expect(settlePeriod(f.db, id, f.p1.id, seen, MEETING, false)).toEqual({
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
    expect(getMeeting(db, MEETING, false)).toEqual({
      period: null,
      runningCutoffAt: null,
      settledToday: false,
    })
    // Mid-week with the rule on: still nothing to show, there is nobody to settle.
    expect(getMeeting(db, prague(2026, 11, 25, 10), true)).toEqual({
      period: null,
      runningCutoffAt: null,
      settledToday: false,
    })
    expect(settlePeriod(db, admin, p1?.id ?? 0, [], MEETING, false)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
    expect(settlePeriod(db, tata, p1?.id ?? 0, [], MEETING, false)).toEqual({
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
      expect(() => settlePeriod(f.db, f.tata, f.p1.id, seen, MEETING, false)).toThrow(/audit down/)
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
    const m = getMeeting(f.db, MONDAY, false)
    if (!m.period) throw new Error('nothing to settle')
    expect(m.takers.find((t) => t.id === f.starsi)).toMatchObject({ total: 55, level: 'lower' })
  })
})

describe('weekWaiting (#48)', () => {
  it('nothing to settle: no week waits', () => {
    expect(weekWaiting(family().db, MEETING)).toBe(false)
  })

  it('an ended, unsettled week waits; the running week settleable early does not', () => {
    const f = week()
    expect(weekWaiting(f.db, MEETING)).toBe(false)
    expect(weekWaiting(f.db, MONDAY)).toBe(true)
  })
})

describe('last day only (#211, spec §5.8)', () => {
  const WED = prague(2026, 11, 25, 10)
  const shownAt = (db: Db, now: Date) => {
    const m = getMeeting(db, now, false)
    return m.period ? m.takers.map((t) => ({ takerId: t.id, total: t.total })) : []
  }

  it('mid-week the meeting shows when the running week ends, not the week', () => {
    const f = example()
    expect(getMeeting(f.db, WED, true)).toEqual({
      period: null,
      runningCutoffAt: CUTOFF.toISOString(),
      settledToday: false,
    })
    expect(getMeeting(f.db, WED, false).period?.id).toBe(f.p1.id)
  })

  it('on the last day the running week is offered', () => {
    const f = example()
    expect(getMeeting(f.db, prague(2026, 11, 29, 0, 0), true).period?.id).toBe(f.p1.id)
    expect(getMeeting(f.db, MEETING, true).period?.id).toBe(f.p1.id)
  })

  it('mid-week settling is refused and writes nothing', () => {
    const f = example()
    const r = settlePeriod(f.db, f.tata, f.p1.id, shownAt(f.db, WED), WED, true)
    expect(r).toEqual({ ok: false, error: 'nothing_to_settle' })
    expect(records(f.db)).toEqual([])
    expect(actions(f.db)).not.toContain('settlement.created')
    expect(listPeriods(f.db)[0]?.endedAt ?? null).toBeNull()
  })

  it('on the last day settling ends the running week', () => {
    const f = example()
    const r = settlePeriod(f.db, f.tata, f.p1.id, shownAt(f.db, MEETING), MEETING, true)
    expect(r.ok).toBe(true)
    expect(records(f.db)).toHaveLength(2)
  })

  it('a late meeting on a weekday still settles the ended week', () => {
    const f = example()
    rollPeriods(f.db, MONDAY, D)
    const wednesday = prague(2026, 12, 2, 10)
    expect(getMeeting(f.db, wednesday, true).period?.id).toBe(f.p1.id)
    const r = settlePeriod(f.db, f.tata, f.p1.id, shownAt(f.db, wednesday), wednesday, true)
    expect(r.ok).toBe(true)
    // Then the running week (P2) waits for its own last day.
    expect(getMeeting(f.db, wednesday, true)).toEqual({
      period: null,
      runningCutoffAt: prague(2026, 12, 6, 23, 59).toISOString(),
      settledToday: true,
    })
  })

  it('no takers or no week: nothing to show', () => {
    expect(getMeeting(family().db, WED, true)).toEqual({
      period: null,
      runningCutoffAt: null,
      settledToday: false,
    })
  })
})

describe('week copies at the settlement (#257, spec §5.12)', () => {
  /** "Nakrmit kočku" every day at 21:00, agreed when P1 starts. */
  function cat(f: ReturnType<typeof example>) {
    const id = must(
      createTemplate(
        f.db,
        f.tata,
        {
          title: 'Nakrmit kočku',
          score: 3,
          approvalRequired: true,
          schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: { hour: 21, minute: 0 } },
          deadline: null,
        },
        T0,
      ),
    ).id
    must(approveTemplateScore(f.db, f.starsi, id, 3, SAT))
    return id
  }
  const weekPlan = (db: Db, on: boolean) =>
    db.update(featureFlags).set({ enabled: on }).where(eq(featureFlags.key, 'weekPlan')).run()
  const copies = (db: Db, id: number) =>
    db.select().from(tasks).where(eq(tasks.templateId, id)).orderBy(asc(tasks.id)).all()
  const day = (d: Date) => d.toISOString()

  it('settlement on Sunday 20:00 makes Monday–Sunday copies in the same transaction; Sunday 21:00’s copy, made by the old week, is not made again', () => {
    const f = example()
    weekPlan(f.db, true)
    const id = cat(f)
    // The old week: Sat 21.11 21:00 … Sun 29.11 21:00.
    expect(copies(f.db, id)).toHaveLength(9)
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
    const rows = copies(f.db, id)
    expect(rows).toHaveLength(16)
    expect(rows.slice(9).map((r) => r.planDayAt)).toEqual(
      [30, 1, 2, 3, 4, 5, 6].map((d) => day(prague(2026, d === 30 ? 11 : 12, d))),
    )
    expect(rows.filter((r) => r.planDayAt === day(prague(2026, 11, 29)))).toHaveLength(1)
    expect(rows.slice(9).every((r) => r.createdAt === MEETING.toISOString())).toBe(true)
  })

  it('a refused settlement leaves no copies', () => {
    const f = example()
    weekPlan(f.db, true)
    const id = cat(f)
    const before = copies(f.db, id).length
    const seen = shown(f.db, MEETING).map((t) => ({ ...t, total: t.total + 1 }))
    expect(settlePeriod(f.db, f.tata, f.p1.id, seen, MEETING, false)).toEqual({
      ok: false,
      error: 'totals_changed',
    })
    expect(copies(f.db, id)).toHaveLength(before)
    expect(listPeriods(f.db)).toHaveLength(1)
  })

  it('settlement with the switch off and a scheduled template in the running period makes no week copies', () => {
    const f = example()
    const id = cat(f)
    expect(copies(f.db, id)).toEqual([])
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
    expect(copies(f.db, id)).toEqual([])
  })
})

describe('settledOnPragueDay (#259)', () => {
  const iso = (d: Date) => d.toISOString()

  it('null → false', () => {
    expect(settledOnPragueDay(null, prague(2026, 11, 26, 10))).toBe(false)
  })

  it('settled at today 00:00 Prague → true from 00:01 to 23:59', () => {
    const at = iso(prague(2026, 11, 26, 0, 0))
    expect(settledOnPragueDay(at, prague(2026, 11, 26, 0, 1))).toBe(true)
    expect(settledOnPragueDay(at, prague(2026, 11, 26, 23, 59))).toBe(true)
  })

  it('settled at yesterday 23:59 Prague → false at 00:00 and 00:01', () => {
    const at = iso(prague(2026, 11, 25, 23, 59))
    expect(settledOnPragueDay(at, prague(2026, 11, 26, 0, 0))).toBe(false)
    expect(settledOnPragueDay(at, prague(2026, 11, 26, 0, 1))).toBe(false)
  })

  it('UTC date differs, Prague date same', () => {
    const now = prague(2026, 11, 26, 10)
    expect(settledOnPragueDay('2026-11-25T23:30:00.000Z', now)).toBe(true)
    expect(settledOnPragueDay('2026-11-25T22:59:00.000Z', now)).toBe(false)
  })

  it('DST autumn (25 h day, 2026-10-25)', () => {
    const at = iso(prague(2026, 10, 25, 0, 30))
    expect(settledOnPragueDay(at, prague(2026, 10, 25, 23, 30))).toBe(true)
    expect(settledOnPragueDay(at, prague(2026, 10, 26, 0, 5))).toBe(false)
  })

  it('DST spring (23 h day, 2026-03-29)', () => {
    expect(settledOnPragueDay(iso(prague(2026, 3, 29, 0, 10)), prague(2026, 3, 29, 23, 50))).toBe(
      true,
    )
    expect(settledOnPragueDay(iso(prague(2026, 3, 28, 23, 30)), prague(2026, 3, 29, 0, 30))).toBe(
      false,
    )
  })

  it('a later settlement time on the same day still counts (now before settledAt is not "today")', () => {
    // Clock skew guard: only the calendar date matters, both ways.
    expect(settledOnPragueDay(iso(prague(2026, 11, 26, 12)), prague(2026, 11, 26, 11))).toBe(true)
    expect(settledOnPragueDay(iso(prague(2026, 11, 27, 1)), prague(2026, 11, 26, 23))).toBe(false)
  })
})

describe('lastSettledAt (#259)', () => {
  it('null with no settlements; the latest of two settled weeks', () => {
    const f = example()
    expect(lastSettledAt(f.db)).toBeNull()
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
    expect(lastSettledAt(f.db)).toBe(MEETING.toISOString())
    const p2 = listPeriods(f.db)[1]
    const at = prague(2026, 12, 6, 20)
    must(settlePeriod(f.db, f.tata, p2?.id ?? 0, shown(f.db, at), at, false))
    expect(lastSettledAt(f.db)).toBe(at.toISOString())
  })
})

describe('getMeeting settledToday (#259)', () => {
  it('true the same Prague day after settling, false the next day', () => {
    const f = example()
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, true))
    const late = getMeeting(f.db, prague(2026, 11, 29, 23, 59), true)
    expect(late.period).toBeNull()
    expect(late.settledToday).toBe(true)
    const next = getMeeting(f.db, prague(2026, 11, 30, 0, 0), true)
    expect(next.period).toBeNull()
    expect(next.settledToday).toBe(false)
  })

  it('true on the period variant too, when an ended week still waits after a settlement today', () => {
    const f = example()
    must(settlePeriod(f.db, f.tata, f.p1.id, shown(f.db, MEETING), MEETING, false))
    expect(getMeeting(f.db, plus(MEETING, 60_000), false)).toMatchObject({
      period: { running: true },
      settledToday: true,
    })
  })

  it('false with no settlement ever: nothing to settle, and a running week', () => {
    expect(getMeeting(family().db, MEETING, false).settledToday).toBe(false)
    const f = example()
    const m = getMeeting(f.db, MEETING, false)
    expect(m.period?.id).toBe(f.p1.id)
    expect(m.settledToday).toBe(false)
  })
})
