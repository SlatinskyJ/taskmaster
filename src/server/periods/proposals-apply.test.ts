import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { PeriodSettings } from '~/domain'
import type { AuditAction } from '~/server/audit'
import type { Db } from '~/server/db'
import { auditLog, defaultsProposals, periodProposals } from '~/server/db/schema'
import { getMeeting, settlePeriod } from '~/server/settlement/meeting'
import { CUTOFF, MEETING, plus, prague, week } from '~/server/settlement/testing'
import { json, must } from '~/server/tasks/testing'
import { getPeriodDefaults } from './defaults'
import { currentLevels, listPeriods, rollPeriods } from './periods'
import { approveProposal, proposeDefaultsChange, proposePeriod } from './proposals'

// An agreed per-period change applies when its period starts, at the cutoff roll or at an early
// settlement; a pending one lapses then (spec §5.8).

const AT = prague(2026, 11, 25, 12)
/** Next week ends Saturday 5 Dec 20:00 at 60/120. */
const NEXT: PeriodSettings = {
  cutoffAt: prague(2026, 12, 5, 20),
  levels: { lower: 60, upper: 120 },
}

type W = ReturnType<typeof week>

function agree(f: W, at = AT): number {
  const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
  must(approveProposal(f.db, f.mladsi, 'period', id, AT))
  must(approveProposal(f.db, f.tata, 'period', id, at))
  return id
}

const statusOf = (db: Db, id: number) =>
  db.select().from(periodProposals).where(eq(periodProposals.id, id)).get()?.status
const audit = (db: Db, action: AuditAction) =>
  db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(asc(auditLog.id)).all()

function settle(f: W, now: Date) {
  const m = getMeeting(f.db, now)
  const totals = m.period ? m.takers.map((t) => ({ takerId: t.id, total: t.total })) : []
  return must(settlePeriod(f.db, f.tata, f.p1.id, totals, now))
}

describe('agreed changes apply at the start', () => {
  it('the roll starts the next period with the agreed cutoff and levels', () => {
    const f = week()
    const id = agree(f)
    const [next] = rollPeriods(f.db, CUTOFF, getPeriodDefaults(f.db))
    expect(next).toMatchObject({ startsAt: CUTOFF, cutoffAt: NEXT.cutoffAt, levels: NEXT.levels })
    expect(json(audit(f.db, 'period.created').at(-1)?.after)).toMatchObject({
      levels: NEXT.levels,
      proposalId: id,
    })
    expect(statusOf(f.db, id)).toBe('agreed')
    expect(audit(f.db, 'period.proposal_lapsed')).toEqual([])
  })

  it('a period started from the defaults has proposalId null', () => {
    const f = week()
    rollPeriods(f.db, CUTOFF, getPeriodDefaults(f.db))
    expect(json(audit(f.db, 'period.created').at(-1)?.after)).toMatchObject({ proposalId: null })
  })

  it('agreed one ms before the cutoff applies', () => {
    const f = week()
    agree(f, plus(CUTOFF, -1))
    const [next] = rollPeriods(f.db, CUTOFF, getPeriodDefaults(f.db))
    expect(next?.levels).toEqual(NEXT.levels)
  })

  it('still pending at the cutoff: lapses at the roll, audited by the system', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
    const [next] = rollPeriods(f.db, CUTOFF, getPeriodDefaults(f.db))
    expect(next?.levels).toEqual({ lower: 50, upper: 100 })
    expect(statusOf(f.db, id)).toBe('lapsed')
    expect(audit(f.db, 'period.proposal_lapsed')).toMatchObject([
      { actorKind: 'system', entityId: String(id) },
    ])
  })

  it('settling early starts the next period with the agreed change; it stays agreed', () => {
    const f = week()
    const id = agree(f)
    const result = settle(f, MEETING)
    expect(result).toMatchObject({ next: { startsAt: MEETING, cutoffAt: NEXT.cutoffAt } })
    expect(listPeriods(f.db)[1]?.levels).toEqual(NEXT.levels)
    expect(statusOf(f.db, id)).toBe('agreed')
  })

  it('settling early lapses a pending per-period proposal', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
    settle(f, MEETING)
    expect(statusOf(f.db, id)).toBe('lapsed')
    expect(audit(f.db, 'period.proposal_lapsed')).toHaveLength(1)
  })

  it('two cutoffs missed: only the first started period takes the change', () => {
    const f = week()
    agree(f)
    const started = rollPeriods(f.db, plus(NEXT.cutoffAt, 1), getPeriodDefaults(f.db))
    expect(started.map((p) => p.levels)).toEqual([NEXT.levels, { lower: 50, upper: 100 }])
  })

  it('a pending defaults proposal stays pending across a roll', () => {
    const f = week()
    const { id } = must(
      proposeDefaultsChange(f.db, f.tata, { ...getPeriodDefaults(f.db), lengthDays: 14 }, AT),
    )
    rollPeriods(f.db, CUTOFF, getPeriodDefaults(f.db))
    const row = f.db.select().from(defaultsProposals).where(eq(defaultsProposals.id, id)).get()
    expect(row?.status).toBe('pending')
  })

  it('between the cutoff and the roll, points show the agreed levels for the next period', () => {
    const f = week()
    agree(f)
    expect(currentLevels(f.db, plus(CUTOFF, 1), getPeriodDefaults(f.db))).toEqual(NEXT.levels)
  })
})
