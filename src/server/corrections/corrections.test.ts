import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { Levels } from '~/domain'
import type { AuditAction } from '~/server/audit'
import type { Db } from '~/server/db'
import {
  auditLog,
  disputes,
  pointAdjustments,
  settlementCorrections,
  settlements,
} from '~/server/db/schema'
import { dismissDisputeIn, loadTarget, openDisputeIn } from '~/server/disputes'
import { getPeriodDefaults, listPeriods, rollPeriods } from '~/server/periods'
import { getMeeting, settlePeriod, takerPointsNow } from '~/server/settlement'
import { doneTask, MEETING, plus, prague, SAT } from '~/server/settlement/testing'
import { failAuditOn, family, json, must } from '~/server/tasks/testing'
import { adjustPointsIn, correctSettlementIn } from './corrections'
import { latestCorrection } from './read'

const H = 3_600_000
/** Monday 30 Nov 10:00: P1 settled early on Sunday 20:00, P2 runs. */
const MONDAY = prague(2026, 11, 30, 10)

/** The family with P1 rolled at SAT, with the given levels (default 50/100). */
function setup(levels?: Levels) {
  const f = family()
  rollPeriods(f.db, SAT, levels ? { ...DEFAULT_PERIOD_DEFAULTS, levels } : getPeriodDefaults(f.db))
  const p1 = listPeriods(f.db)[0]
  if (!p1) throw new Error('no period')
  return { ...f, p1 }
}
type F = ReturnType<typeof setup>

const earn = (f: F, taker: number, score: number, at = plus(SAT, H)) =>
  doneTask(f, { score, completedAt: at, earner: taker })

/** Táta settles the week the meeting shows at `now`. */
function settle(db: Db, tata: number, now: Date) {
  const m = getMeeting(db, now)
  if (!m.period) throw new Error('nothing to settle')
  must(
    settlePeriod(
      db,
      tata,
      m.period.id,
      m.takers.map((t) => ({ takerId: t.id, total: t.total })),
      now,
    ),
  )
}

const settlementOf = (f: F, taker: number) => {
  const s = f.db
    .select()
    .from(settlements)
    .where(eq(settlements.takerId, taker))
    .orderBy(asc(settlements.id))
    .all()
    .at(-1)
  if (!s) throw new Error('no settlement')
  return s
}
const total = (f: F, taker: number) => takerPointsNow(f.db).get(taker)?.confirmed ?? 0
const adjustments = (f: F) => f.db.select().from(pointAdjustments).all()
const corrections = (f: F) => f.db.select().from(settlementCorrections).all()
const audits = (f: F, action: AuditAction) =>
  f.db.select().from(auditLog).where(eq(auditLog.action, action)).all()
/** Who, on what: the admin as a user, on the entity type. */
const byAdminOn = (f: F, entityType: string) => ({
  actorKind: 'user',
  actorUserId: f.admin,
  entityType,
})

/** Starší earns 60 in P1 (levels 50/100): settled early on Sunday → lower, 50 off, 10 carry. */
function settledLower(levels?: Levels) {
  const f = setup(levels)
  earn(f, f.starsi, 60)
  settle(f.db, f.tata, MEETING)
  return { ...f, s: settlementOf(f, f.starsi) }
}

const adjust = (f: F, points: number, now = MONDAY, actor = f.admin, taker = f.starsi) =>
  adjustPointsIn(f.db, actor, { takerId: taker, points, reason: ' Pomoc s nákupem. ' }, null, now)

const correct = (f: F, settlementId: number, level: 'none' | 'lower' | 'upper', now = MONDAY) =>
  correctSettlementIn(f.db, f.admin, { settlementId, level, reason: 'Chyběl úkol.' }, null, now)

describe('adjustPointsIn', () => {
  it('+5 writes a row (reason trimmed) and points.adjusted, and today’s total moves', () => {
    const f = settledLower()
    const r = must(adjust(f, 5))
    expect(adjustments(f)).toEqual([
      expect.objectContaining({
        id: r.adjustmentId,
        takerId: f.starsi,
        points: 5,
        reason: 'Pomoc s nákupem.',
        correctionId: null,
        disputeId: null,
        madeBy: f.admin,
        madeAt: MONDAY.toISOString(),
      }),
    ])
    const [a] = audits(f, 'points.adjusted')
    expect(a).toMatchObject(byAdminOn(f, 'adjustment'))
    expect(a?.entityId).toBe(String(r.adjustmentId))
    expect(json(a?.after)).toEqual({
      takerId: f.starsi,
      points: 5,
      reason: 'Pomoc s nákupem.',
      correctionId: null,
      disputeId: null,
    })
    expect(total(f, f.starsi)).toBe(15)
  })

  it('a removal down to exactly 0 passes; one more point is would_go_negative', () => {
    const f = settledLower() // total 10
    expect(adjust(f, -11)).toEqual({ ok: false, error: 'would_go_negative' })
    must(adjust(f, -10))
    expect(total(f, f.starsi)).toBe(0)
  })

  it('wrong actor, wrong taker, blank reason', () => {
    const f = settledLower()
    expect(adjust(f, 5, MONDAY, f.tata)).toEqual({ ok: false, error: 'not_admin' })
    expect(adjust(f, 5, MONDAY, f.starsi)).toEqual({ ok: false, error: 'not_admin' })
    expect(adjust(f, 5, MONDAY, f.admin, f.tata)).toEqual({ ok: false, error: 'not_a_taker' })
    expect(
      adjustPointsIn(f.db, f.admin, { takerId: f.starsi, points: 5, reason: '  ' }, null, MONDAY),
    ).toEqual({ ok: false, error: 'reason_required' })
    expect(adjustments(f)).toEqual([])
  })

  it('a failed audit write rolls the adjustment back', () => {
    const f = settledLower()
    failAuditOn(f.db, 'points.adjusted')
    expect(() => adjust(f, 5)).toThrow(/audit down/)
    expect(adjustments(f)).toEqual([])
  })
})

describe('correctSettlementIn', () => {
  it('lower → upper writes a correction and an adjustment of lower − upper, linked', () => {
    const f = settledLower()
    must(adjust(f, 60)) // total 70, room for −50
    const r = must(correct(f, f.s.id, 'upper'))
    expect(corrections(f)).toEqual([
      expect.objectContaining({
        id: r.correctionId,
        settlementId: f.s.id,
        level: 'upper',
        deducted: 100,
        reason: 'Chyběl úkol.',
        disputeId: null,
      }),
    ])
    const fix = adjustments(f).find((a) => a.id === r.adjustmentId)
    expect(fix).toMatchObject({ points: -50, correctionId: r.correctionId, disputeId: null })
    expect(total(f, f.starsi)).toBe(20)
    // The settlement row itself is unchanged.
    expect(settlementOf(f, f.starsi)).toEqual(f.s)
    const [c] = audits(f, 'settlement.corrected')
    expect(c).toMatchObject(byAdminOn(f, 'settlement'))
    expect(c?.entityId).toBe(String(f.s.id))
    expect(json(c?.before)).toEqual({ level: 'lower', deducted: 50 })
    expect(json(c?.after)).toEqual({
      correctionId: r.correctionId,
      level: 'upper',
      deducted: 100,
      reason: 'Chyběl úkol.',
    })
    expect(audits(f, 'points.adjusted').map((a) => json(a.after))).toContainEqual({
      takerId: f.starsi,
      points: -50,
      reason: 'Chyběl úkol.',
      correctionId: r.correctionId,
      disputeId: null,
    })
  })

  it('lower → none gives the deduction back; the same level is no_change', () => {
    const f = settledLower()
    expect(correct(f, f.s.id, 'lower')).toEqual({ ok: false, error: 'no_change' })
    must(correct(f, f.s.id, 'none'))
    expect(total(f, f.starsi)).toBe(60)
  })

  it('three corrections: each measured from the one before', () => {
    const f = settledLower()
    must(adjust(f, 100)) // total 110
    must(correct(f, f.s.id, 'none', plus(MONDAY, 1))) // +50 → 160
    expect(total(f, f.starsi)).toBe(160)
    must(correct(f, f.s.id, 'upper', plus(MONDAY, 2))) // none → upper: −100 → 60
    expect(total(f, f.starsi)).toBe(60)
    must(correct(f, f.s.id, 'lower', plus(MONDAY, 3))) // upper → lower: +50 → 110
    expect(total(f, f.starsi)).toBe(110)
    expect(latestCorrection(f.db, f.s.id)?.level).toBe('lower')
    // Each correction's `before` is the one before it.
    expect(audits(f, 'settlement.corrected').map((a) => json(a.before))).toEqual([
      { level: 'lower', deducted: 50 },
      { level: 'none', deducted: 0 },
      { level: 'upper', deducted: 100 },
    ])
    expect(loadTarget(f.db, { kind: 'settlement', id: f.s.id })?.value).toEqual({
      level: 'lower',
      deducted: 50,
    })
  })

  it("uses the settled week's levels, not the running week's", () => {
    const f = settledLower({ lower: 30, upper: 60 }) // 60 → upper here: 60 off, 0 carry
    expect(listPeriods(f.db).at(-1)?.levels).toEqual({ lower: 50, upper: 100 }) // week 2
    expect(f.s).toMatchObject({ level: 'upper', deducted: 60 })
    must(correct(f, f.s.id, 'lower'))
    expect(corrections(f)[0]).toMatchObject({ level: 'lower', deducted: 30 })
    expect(total(f, f.starsi)).toBe(30)
  })

  it('equal levels: lower → upper writes a correction and no adjustment', () => {
    const f = settledLower({ lower: 50, upper: 50 })
    expect(f.s).toMatchObject({ level: 'upper', deducted: 50 })
    const r = must(correct(f, f.s.id, 'lower'))
    expect(r.adjustmentId).toBeNull()
    expect(corrections(f)).toHaveLength(1)
    expect(adjustments(f)).toEqual([])
  })

  it('a difference that would go below zero is refused; nothing written', () => {
    const f = settledLower() // total 10, lower → upper is −50
    expect(correct(f, f.s.id, 'upper')).toEqual({ ok: false, error: 'would_go_negative' })
    expect(corrections(f)).toEqual([])
    expect(adjustments(f)).toEqual([])
  })

  it('an unknown settlement is not_found; a giver is not_admin', () => {
    const f = settledLower()
    expect(correct(f, 999, 'none')).toEqual({ ok: false, error: 'not_found' })
    expect(
      correctSettlementIn(
        f.db,
        f.tata,
        { settlementId: f.s.id, level: 'none', reason: 'x' },
        null,
        MONDAY,
      ),
    ).toEqual({ ok: false, error: 'not_admin' })
  })

  it('a failed audit write rolls the correction and its adjustment back', () => {
    const f = settledLower()
    failAuditOn(f.db, 'points.adjusted')
    expect(() => correct(f, f.s.id, 'none')).toThrow(/audit down/)
    expect(corrections(f)).toEqual([])
    expect(adjustments(f)).toEqual([])
  })
})

describe('no removal while a week waits for its meeting (ruling 8)', () => {
  /** Week 1 ended at its cutoff (Sun 29 Nov 23:59) with 100 points, no meeting yet. */
  function waiting() {
    const f = setup()
    earn(f, f.starsi, 100)
    return f
  }

  it('a removal is week_waiting; an addition passes; after the meeting the removal passes', () => {
    const f = waiting()
    expect(adjust(f, -5)).toEqual({ ok: false, error: 'week_waiting' })
    must(adjust(f, 5))
    rollPeriods(f.db, MONDAY, getPeriodDefaults(f.db))
    settle(f.db, f.tata, plus(MONDAY, 1)) // week 1: 100 → upper, 0 carry; the +5 is in week 2
    must(adjust(f, -5, plus(MONDAY, 2)))
    expect(total(f, f.starsi)).toBe(0)
  })

  it('a correction that removes points is week_waiting; one that adds passes', () => {
    // Week 1 settled early on Sunday; week 2 ended unsettled by the next Monday.
    const f = settledLower()
    must(adjust(f, 100)) // total 110
    const LATER = prague(2026, 12, 7, 10)
    expect(correct(f, f.s.id, 'upper', LATER)).toEqual({ ok: false, error: 'week_waiting' })
    must(correct(f, f.s.id, 'none', LATER))
  })

  it('the running week settleable early does not count: removal passes, the meeting stays ≥ 0', () => {
    const f = settledLower() // week 2 runs, may be settled early; no ended week waits
    must(adjust(f, -10)) // down to exactly 0
    earn(f, f.starsi, 55, plus(MONDAY, H))
    const SUNDAY = prague(2026, 12, 6, 20)
    settle(f.db, f.tata, SUNDAY) // week 2: 0 + 55 → lower, 5 carry
    expect(total(f, f.starsi)).toBe(5)
    expect(getMeeting(f.db, prague(2026, 12, 13, 20)).period).not.toBeNull()
  })
})

describe('fixing a dispute', () => {
  function disputed() {
    const f = settledLower()
    must(adjust(f, 100)) // total 110
    const { id } = must(
      openDisputeIn(f.db, f.starsi, { kind: 'settlement', id: f.s.id }, 'Měl jsem víc.', MONDAY),
    )
    return { ...f, disputeId: id }
  }
  const seen = { level: 'lower' as const, deducted: 50 }

  it('a correction closes it corrected with the reason as note, linked both ways', () => {
    const f = disputed()
    const from = { disputeId: f.disputeId, seen }
    const r = must(
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: f.s.id, level: 'upper', reason: 'Chyběl úkol.' },
        from,
        MONDAY,
      ),
    )
    expect(f.db.select().from(disputes).where(eq(disputes.id, f.disputeId)).get()).toMatchObject({
      status: 'corrected',
      resolvedBy: f.admin,
      note: 'Chyběl úkol.',
    })
    expect(corrections(f)[0]?.disputeId).toBe(f.disputeId)
    expect(adjustments(f).find((a) => a.id === r.adjustmentId)?.disputeId).toBe(f.disputeId)
    const [d] = audits(f, 'dispute.corrected')
    expect(d).toMatchObject(byAdminOn(f, 'dispute'))
    expect(d?.entityId).toBe(String(f.disputeId))
    expect(json(d?.before)).toEqual({ status: 'open' })
    expect(json(d?.after)).toEqual({
      status: 'corrected',
      note: 'Chyběl úkol.',
      value: seen,
      correction: { kind: 'settlement_correction', id: r.correctionId },
    })
    expect(audits(f, 'settlement.corrected')).toHaveLength(1)
  })

  it('a correction of another settlement is wrong_correction; nothing written', () => {
    const f = setup()
    earn(f, f.starsi, 60)
    earn(f, f.mladsi, 60)
    settle(f.db, f.tata, MEETING)
    const mine = settlementOf(f, f.starsi)
    const other = settlementOf(f, f.mladsi)
    const { id } = must(
      openDisputeIn(f.db, f.starsi, { kind: 'settlement', id: mine.id }, 'Hm.', MONDAY),
    )
    expect(
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: other.id, level: 'none', reason: 'x' },
        { disputeId: id, seen },
        MONDAY,
      ),
    ).toEqual({ ok: false, error: 'wrong_correction' })
    expect(corrections(f)).toEqual([])
    expect(adjustments(f)).toEqual([])
  })

  it('a stale seen value is value_changed, for a correction and for an adjustment', () => {
    const f = disputed()
    const stale = { disputeId: f.disputeId, seen: { level: 'none' as const, deducted: 0 } }
    expect(
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: f.s.id, level: 'upper', reason: 'x' },
        stale,
        MONDAY,
      ),
    ).toEqual({ ok: false, error: 'value_changed' })
    expect(
      adjustPointsIn(f.db, f.admin, { takerId: f.starsi, points: 5, reason: 'x' }, stale, MONDAY),
    ).toEqual({ ok: false, error: 'value_changed' })
    expect(corrections(f)).toEqual([])
  })

  it('an unknown dispute is not_found and writes nothing', () => {
    const f = disputed()
    const before = adjustments(f).length
    expect(
      adjustPointsIn(
        f.db,
        f.admin,
        { takerId: f.starsi, points: 5, reason: 'x' },
        { disputeId: 999, seen },
        MONDAY,
      ),
    ).toEqual({ ok: false, error: 'not_found' })
    expect(adjustments(f)).toHaveLength(before)
  })

  it('a closed dispute is not_open and writes nothing', () => {
    const f = disputed()
    must(dismissDisputeIn(f.db, f.admin, f.disputeId, seen, 'Sedí.', MONDAY))
    const before = adjustments(f).length
    expect(
      adjustPointsIn(
        f.db,
        f.admin,
        { takerId: f.starsi, points: 5, reason: 'x' },
        { disputeId: f.disputeId, seen },
        MONDAY,
      ),
    ).toEqual({ ok: false, error: 'not_open' })
    expect(adjustments(f)).toHaveLength(before)
  })

  it('an adjustment fixes a completion dispute', () => {
    const f = settledLower()
    const task = earn(f, f.starsi, 9, plus(MONDAY, -H))
    const { id } = must(
      openDisputeIn(f.db, f.starsi, { kind: 'completion', id: task }, 'Bylo to víc.', MONDAY),
    )
    const r = must(
      adjustPointsIn(
        f.db,
        f.admin,
        { takerId: f.starsi, points: 3, reason: 'Doplatek.' },
        { disputeId: id, seen: { score: 9 } },
        MONDAY,
      ),
    )
    expect(f.db.select().from(disputes).where(eq(disputes.id, id)).get()?.status).toBe('corrected')
    expect(json(audits(f, 'dispute.corrected')[0]?.after)).toMatchObject({
      correction: { kind: 'adjustment', id: r.adjustmentId },
    })
  })

  it('a failed dispute.corrected audit rolls everything back', () => {
    const f = disputed()
    failAuditOn(f.db, 'dispute.corrected')
    const before = adjustments(f).length
    expect(() =>
      correctSettlementIn(
        f.db,
        f.admin,
        { settlementId: f.s.id, level: 'upper', reason: 'x' },
        { disputeId: f.disputeId, seen },
        MONDAY,
      ),
    ).toThrow(/audit down/)
    expect(corrections(f)).toEqual([])
    expect(adjustments(f)).toHaveLength(before)
    expect(f.db.select().from(disputes).where(eq(disputes.id, f.disputeId)).get()?.status).toBe(
      'open',
    )
  })
})

describe('dispute targets (#48)', () => {
  it('an adjustment opens as a locked item: value its points, title its reason', () => {
    const f = settledLower()
    const { adjustmentId } = must(adjust(f, 5))
    expect(loadTarget(f.db, { kind: 'adjustment', id: adjustmentId })).toEqual({
      target: { kind: 'adjustment', id: adjustmentId },
      value: { points: 5 },
      about: { title: 'Pomoc s nákupem.', takerId: f.starsi, week: null },
    })
    must(openDisputeIn(f.db, f.starsi, { kind: 'adjustment', id: adjustmentId }, 'Málo.', MONDAY))
  })

  it("a settlement's value after a correction is the corrected one", () => {
    const f = settledLower()
    must(correct(f, f.s.id, 'none'))
    const { id } = must(
      openDisputeIn(f.db, f.starsi, { kind: 'settlement', id: f.s.id }, 'Hm.', MONDAY),
    )
    expect(
      dismissDisputeIn(f.db, f.admin, id, { level: 'lower', deducted: 50 }, 'Sedí.', MONDAY),
    ).toEqual({ ok: false, error: 'value_changed' })
    must(dismissDisputeIn(f.db, f.admin, id, { level: 'none', deducted: 0 }, 'Sedí.', MONDAY))
  })
})
