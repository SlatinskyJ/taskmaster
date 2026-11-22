import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { PeriodDefaults, PeriodSettings } from '~/domain'
import { addPragueDays, fromPragueWallTime } from '~/domain/dates'
import type { Db } from '~/server/db'
import { auditLog, defaultsProposals, periodProposals, users } from '~/server/db/schema'
import { addGiver, failAuditOn, family, must } from '~/server/tasks/testing'
import type { Family } from '~/server/tasks/testing'
import { editPerson } from '~/server/users/admin'
import { getPeriodDefaults } from './defaults'
import { listPeriods, rollPeriods } from './periods'
import {
  approveProposal,
  proposalsView,
  proposeDefaultsChange,
  proposePeriod,
  rejectProposal,
  withdrawProposal,
} from './proposals'

// Proposals for next week and for the default week (spec §3 period agreement, §5.8).

const prague = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  fromPragueWallTime({ year, month, day, hour, minute })
const SAT = prague(2026, 11, 21, 20) // first roll
const CUTOFF = prague(2026, 11, 29, 23, 59) // first period's cutoff
const AT = prague(2026, 11, 25, 12)
const ms = (d: Date, n: number) => new Date(d.getTime() + n)

/** Next week ends Saturday 6 Dec 20:00 at 60/120. */
const NEXT: PeriodSettings = {
  cutoffAt: prague(2026, 12, 6, 20),
  levels: { lower: 60, upper: 120 },
}
const NEW_DEFAULTS: PeriodDefaults = {
  lengthDays: 14,
  cutoff: { weekday: 6, hour: 20, minute: 0 },
  levels: { lower: 60, upper: 120 },
}

function week() {
  const f = family()
  rollPeriods(f.db, SAT, DEFAULT_PERIOD_DEFAULTS)
  return f
}

const actions = (db: Db) =>
  db
    .select({ action: auditLog.action, kind: auditLog.actorKind })
    .from(auditLog)
    .orderBy(asc(auditLog.id))
    .all()
const actionNames = (db: Db, prefix: string) =>
  actions(db)
    .map((a) => a.action)
    .filter((a) => a.startsWith(prefix))
const periodRow = (db: Db, id: number) =>
  db.select().from(periodProposals).where(eq(periodProposals.id, id)).get()
const defaultsRow = (db: Db, id: number) =>
  db.select().from(defaultsProposals).where(eq(defaultsProposals.id, id)).get()

function agreedNextWeek(f: Family): number {
  const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
  must(approveProposal(f.db, f.mladsi, 'period', id, AT))
  must(approveProposal(f.db, f.tata, 'period', id, AT))
  return id
}

const entries = (db: Db) =>
  db
    .select({
      action: auditLog.action,
      actorKind: auditLog.actorKind,
      actorUserId: auditLog.actorUserId,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .orderBy(asc(auditLog.id))
    .all()
    .filter((e) => e.action.includes('.proposal_'))
    .map((e) => ({
      ...e,
      before: e.before === null ? null : (JSON.parse(e.before) as unknown),
      after: e.after === null ? null : (JSON.parse(e.after) as unknown),
    }))

describe('proposePeriod and approvals', () => {
  it('Starší proposes 60/120 for next week; Mladší and Táta approve → agreed, audited', () => {
    const f = week()
    const id = agreedNextWeek(f)
    expect(periodRow(f.db, id)?.status).toBe('agreed')
    expect(actionNames(f.db, 'period.proposal')).toEqual([
      'period.proposal_created',
      'period.proposal_approved',
      'period.proposal_approved',
      'period.proposal_agreed',
    ])
  })

  it('audit entries name who acted, the proposal and the state before and after', () => {
    const f = week()
    const id = agreedNextWeek(f)
    const e = { entityType: 'period_proposal', entityId: String(id) }
    const settings = { cutoffAt: NEXT.cutoffAt.toISOString(), levels: NEXT.levels }
    expect(entries(f.db)).toEqual([
      {
        ...e,
        action: 'period.proposal_created',
        actorKind: 'user',
        actorUserId: f.starsi,
        before: null,
        after: { status: 'pending', approvedBy: [f.starsi], afterPeriodId: 1, settings },
      },
      {
        ...e,
        action: 'period.proposal_approved',
        actorKind: 'user',
        actorUserId: f.mladsi,
        before: { status: 'pending', approvedBy: [f.starsi] },
        after: { status: 'pending', approvedBy: [f.starsi, f.mladsi] },
      },
      {
        ...e,
        action: 'period.proposal_approved',
        actorKind: 'user',
        actorUserId: f.tata,
        before: { status: 'pending', approvedBy: [f.starsi, f.mladsi] },
        after: { status: 'agreed', approvedBy: [f.starsi, f.mladsi, f.tata] },
      },
      {
        ...e,
        action: 'period.proposal_agreed',
        actorKind: 'user',
        actorUserId: f.tata,
        before: { status: 'pending', approvedBy: [f.starsi, f.mladsi] },
        after: { status: 'agreed', approvedBy: [f.starsi, f.mladsi, f.tata] },
      },
    ])
    expect(periodRow(f.db, id)?.closedAt).toBeNull()
  })

  it('the defaults created entry carries the proposed settings', () => {
    const f = week()
    const { id } = must(proposeDefaultsChange(f.db, f.tata, NEW_DEFAULTS, AT))
    expect(entries(f.db)).toEqual([
      {
        action: 'defaults.proposal_created',
        actorKind: 'user',
        actorUserId: f.tata,
        entityType: 'defaults_proposal',
        entityId: String(id),
        before: null,
        after: { status: 'pending', approvedBy: [f.tata], settings: NEW_DEFAULTS },
      },
    ])
  })

  it('unknown ids are not_found, not a throw', () => {
    const f = week()
    for (const kind of ['period', 'defaults'] as const) {
      expect(approveProposal(f.db, f.tata, kind, 99, AT)).toEqual({ ok: false, error: 'not_found' })
      expect(rejectProposal(f.db, f.tata, kind, 99, AT)).toEqual({ ok: false, error: 'not_found' })
      expect(withdrawProposal(f.db, f.tata, kind, 99, AT)).toEqual({
        ok: false,
        error: 'not_found',
      })
    }
  })

  it('agreed at creation (a family with no takers): agreed and audited at once', () => {
    const f = week()
    f.db.update(users).set({ role: 'giver' }).where(eq(users.role, 'taker')).run()
    const { id } = must(proposePeriod(f.db, f.tata, NEXT, AT))
    expect(periodRow(f.db, id)?.status).toBe('agreed')
    expect(actionNames(f.db, 'period.proposal')).toEqual([
      'period.proposal_created',
      'period.proposal_agreed',
    ])
  })

  it('proposing alone is pending; the proposer counts as approving', () => {
    const f = week()
    expect(proposePeriod(f.db, f.starsi, NEXT, AT)).toEqual({
      ok: true,
      value: { id: 1, status: 'pending' },
    })
    expect(proposalsView(f.db, AT).period).toMatchObject({ approvedBy: [f.starsi] })
  })

  it('a second proposal while one is pending or agreed is refused', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
    expect(proposePeriod(f.db, f.tata, NEXT, AT)).toEqual({ ok: false, error: 'proposal_pending' })
    must(approveProposal(f.db, f.mladsi, 'period', id, AT))
    must(approveProposal(f.db, f.tata, 'period', id, AT))
    expect(proposePeriod(f.db, f.tata, NEXT, AT)).toEqual({ ok: false, error: 'already_agreed' })
  })

  it('the admin cannot propose or approve (not_a_party)', () => {
    const f = week()
    expect(proposePeriod(f.db, f.admin, NEXT, AT)).toEqual({ ok: false, error: 'not_a_party' })
    const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
    expect(approveProposal(f.db, f.admin, 'period', id, AT)).toEqual({
      ok: false,
      error: 'not_a_party',
    })
  })

  it('only the proposer withdraws; any party rejects; a closed one cannot be approved', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
    expect(withdrawProposal(f.db, f.tata, 'period', id, AT)).toEqual({
      ok: false,
      error: 'not_proposer',
    })
    expect(rejectProposal(f.db, f.mladsi, 'period', id, AT)).toEqual({
      ok: true,
      value: { id, status: 'rejected' },
    })
    expect(periodRow(f.db, id)).toMatchObject({ closedBy: f.mladsi, closedAt: AT.toISOString() })
    expect(approveProposal(f.db, f.tata, 'period', id, AT)).toEqual({
      ok: false,
      error: 'not_pending',
    })
    const second = must(proposePeriod(f.db, f.tata, NEXT, AT))
    expect(withdrawProposal(f.db, f.tata, 'period', second.id, AT).ok).toBe(true)
    expect(actionNames(f.db, 'period.proposal')).toContain('period.proposal_withdrawn')
    expect(actionNames(f.db, 'period.proposal')).toContain('period.proposal_rejected')
  })

  it('approving at the cutoff is refused, the row stays pending, nothing audited', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
    must(approveProposal(f.db, f.mladsi, 'period', id, ms(CUTOFF, -1)))
    const before = actions(f.db).length
    expect(approveProposal(f.db, f.tata, 'period', id, CUTOFF)).toEqual({
      ok: false,
      error: 'already_started',
    })
    expect(periodRow(f.db, id)?.status).toBe('pending')
    expect(actions(f.db)).toHaveLength(before)
  })

  it('a cutoff more than 364 days after the running cutoff is invalid_settings', () => {
    const f = week()
    const last = addPragueDays(CUTOFF, 364)
    expect(proposePeriod(f.db, f.starsi, { ...NEXT, cutoffAt: ms(last, 1) }, AT)).toEqual({
      ok: false,
      error: 'invalid_settings',
    })
    expect(proposePeriod(f.db, f.starsi, { ...NEXT, cutoffAt: last }, AT).ok).toBe(true)
  })

  it('no running period (before the first roll) → no_running_period', () => {
    const f = family()
    expect(proposePeriod(f.db, f.starsi, NEXT, AT)).toEqual({
      ok: false,
      error: 'no_running_period',
    })
  })

  it('a failed audit write rolls back the approval', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
    failAuditOn(f.db, 'period.proposal_approved')
    expect(() => approveProposal(f.db, f.mladsi, 'period', id, AT)).toThrow(/audit down/)
    expect(proposalsView(f.db, AT).period).toMatchObject({ approvedBy: [f.starsi] })
  })
})

describe('default-week proposals', () => {
  it('a second defaults proposal while one is pending is proposal_pending', () => {
    const f = week()
    must(proposeDefaultsChange(f.db, f.tata, NEW_DEFAULTS, AT))
    expect(proposeDefaultsChange(f.db, f.tata, DEFAULT_PERIOD_DEFAULTS, AT)).toEqual({
      ok: false,
      error: 'proposal_pending',
    })
  })

  it('a taker cannot propose defaults (not_a_giver)', () => {
    const f = week()
    expect(proposeDefaultsChange(f.db, f.starsi, NEW_DEFAULTS, AT)).toEqual({
      ok: false,
      error: 'not_a_giver',
    })
  })

  it('agreed by the last taker: stored at once; the running period keeps its levels', () => {
    const f = week()
    const { id } = must(proposeDefaultsChange(f.db, f.tata, NEW_DEFAULTS, AT))
    must(approveProposal(f.db, f.starsi, 'defaults', id, AT))
    expect(getPeriodDefaults(f.db)).toEqual(DEFAULT_PERIOD_DEFAULTS)
    must(approveProposal(f.db, f.mladsi, 'defaults', id, AT))
    expect(defaultsRow(f.db, id)?.status).toBe('agreed')
    expect(getPeriodDefaults(f.db)).toEqual(NEW_DEFAULTS)
    expect(listPeriods(f.db)[0]?.levels).toEqual({ lower: 50, upper: 100 })
    expect(
      actions(f.db)
        .map((a) => a.action)
        .slice(-3),
    ).toEqual(['defaults.proposal_approved', 'defaults.proposal_agreed', 'settings.changed'])
  })

  it('a failed settings write rolls back the agreeing approval', () => {
    const f = week()
    const { id } = must(proposeDefaultsChange(f.db, f.tata, NEW_DEFAULTS, AT))
    must(approveProposal(f.db, f.starsi, 'defaults', id, AT))
    failAuditOn(f.db, 'settings.changed')
    expect(() => approveProposal(f.db, f.mladsi, 'defaults', id, AT)).toThrow(/audit down/)
    expect(defaultsRow(f.db, id)?.status).toBe('pending')
    expect(getPeriodDefaults(f.db)).toEqual(DEFAULT_PERIOD_DEFAULTS)
  })

  it('agreed at creation (a family with no takers) is stored at once', () => {
    const f = week()
    f.db.update(users).set({ role: 'giver' }).where(eq(users.role, 'taker')).run()
    const { id } = must(proposeDefaultsChange(f.db, f.tata, NEW_DEFAULTS, AT))
    expect(defaultsRow(f.db, id)?.status).toBe('agreed')
    expect(getPeriodDefaults(f.db)).toEqual(NEW_DEFAULTS)
    expect(
      actions(f.db)
        .map((a) => a.action)
        .slice(-3),
    ).toEqual(['defaults.proposal_created', 'defaults.proposal_agreed', 'settings.changed'])
  })
})

describe('people changes (role change in the admin console)', () => {
  it('a taker who had not approved becomes a giver: the per-period proposal is agreed', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.mladsi, NEXT, AT))
    must(approveProposal(f.db, f.tata, 'period', id, AT))
    must(editPerson(f.db, f.admin, f.starsi, { role: 'giver' }, AT))
    expect(periodRow(f.db, id)?.status).toBe('agreed')
    expect(actions(f.db).at(-1)).toEqual({ action: 'period.proposal_agreed', kind: 'system' })
  })

  it('…the defaults proposal is agreed and stored, audited by the system', () => {
    const f = week()
    const { id } = must(proposeDefaultsChange(f.db, f.tata, NEW_DEFAULTS, AT))
    must(approveProposal(f.db, f.mladsi, 'defaults', id, AT))
    must(editPerson(f.db, f.admin, f.starsi, { role: 'giver' }, AT))
    expect(defaultsRow(f.db, id)?.status).toBe('agreed')
    expect(getPeriodDefaults(f.db)).toEqual(NEW_DEFAULTS)
    expect(actions(f.db).slice(-2)).toEqual([
      { action: 'defaults.proposal_agreed', kind: 'system' },
      { action: 'settings.changed', kind: 'system' },
    ])
  })

  it('a people change that does not complete agreement leaves both proposals pending', () => {
    const f = week()
    const mama = addGiver(f)
    const period = must(proposePeriod(f.db, f.mladsi, NEXT, AT)).id
    const defaults = must(proposeDefaultsChange(f.db, f.tata, NEW_DEFAULTS, AT)).id
    // Máma becomes a taker who has approved neither: the hooks run, nothing is agreed.
    must(editPerson(f.db, f.admin, mama, { role: 'taker' }, AT))
    expect(periodRow(f.db, period)?.status).toBe('pending')
    expect(defaultsRow(f.db, defaults)?.status).toBe('pending')
    expect(getPeriodDefaults(f.db)).toEqual(DEFAULT_PERIOD_DEFAULTS)
    expect(actionNames(f.db, 'period.proposal_agreed')).toEqual([])
    expect(actionNames(f.db, 'defaults.proposal_agreed')).toEqual([])
  })

  it('the agreed entry of a people change shows the pending state it moved from', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.mladsi, NEXT, AT))
    must(approveProposal(f.db, f.tata, 'period', id, AT))
    must(editPerson(f.db, f.admin, f.starsi, { role: 'giver' }, AT))
    expect(entries(f.db).at(-1)).toMatchObject({
      action: 'period.proposal_agreed',
      actorKind: 'system',
      before: { status: 'pending', approvedBy: [f.mladsi, f.tata] },
      after: { status: 'agreed', approvedBy: [f.mladsi, f.tata] },
    })
  })

  it('a role change after the cutoff, before the roll: stays pending, the roll lapses it', () => {
    const f = week()
    const { id } = must(proposePeriod(f.db, f.mladsi, NEXT, AT))
    must(approveProposal(f.db, f.tata, 'period', id, AT))
    const late = ms(CUTOFF, 60_000)
    // editPerson rolls nothing; the roller has not ticked since the cutoff.
    must(editPerson(f.db, f.admin, f.starsi, { role: 'giver' }, late))
    expect(periodRow(f.db, id)?.status).toBe('pending')
    const [next] = rollPeriods(f.db, late, getPeriodDefaults(f.db))
    expect(periodRow(f.db, id)?.status).toBe('lapsed')
    expect(next?.levels).toEqual({ lower: 50, upper: 100 })
  })
})

describe('proposalsView', () => {
  it('waitingFor lists who has not approved; with two givers, one giver is enough', () => {
    const f = week()
    const mama = addGiver(f)
    const { id } = must(proposePeriod(f.db, f.starsi, NEXT, AT))
    expect(proposalsView(f.db, AT).period?.waitingFor).toEqual([f.tata, f.mladsi, mama])
    must(approveProposal(f.db, f.tata, 'period', id, AT))
    const { period, defaults } = proposalsView(f.db, AT)
    expect({ period, defaults }).toEqual({
      period: {
        id,
        settings: { cutoffAt: NEXT.cutoffAt.toISOString(), levels: NEXT.levels },
        proposedBy: f.starsi,
        approvedBy: [f.starsi, f.tata],
        status: 'pending',
        waitingFor: [f.mladsi],
      },
      defaults: null,
    })
  })

  it('shows the agreed next-week change with its settings', () => {
    const f = week()
    const id = agreedNextWeek(f)
    expect(proposalsView(f.db, AT).period).toEqual({
      id,
      settings: { cutoffAt: NEXT.cutoffAt.toISOString(), levels: NEXT.levels },
      proposedBy: f.starsi,
      approvedBy: [f.starsi, f.mladsi, f.tata],
      status: 'agreed',
      waitingFor: [],
    })
  })

  it('shows the pending defaults proposal', () => {
    const f = week()
    const { id } = must(proposeDefaultsChange(f.db, f.tata, NEW_DEFAULTS, AT))
    expect(proposalsView(f.db, AT).defaults).toEqual({
      id,
      settings: NEW_DEFAULTS,
      proposedBy: f.tata,
      approvedBy: [f.tata],
      status: 'pending',
      waitingFor: [f.starsi, f.mladsi],
    })
  })
})

describe('proposalsView context for the screens', () => {
  const span = (startsAt: Date, cutoffAt: Date, levels = DEFAULT_PERIOD_DEFAULTS.levels) => ({
    startsAt: startsAt.toISOString(),
    cutoffAt: cutoffAt.toISOString(),
    levels,
  })
  const DEFAULT_NEXT_CUTOFF = prague(2026, 12, 6, 23, 59)

  it('names the running week, the defaults and the parties (no admin); next = the default week', () => {
    const f = week()
    expect(proposalsView(f.db, AT)).toEqual({
      period: null,
      defaults: null,
      running: span(SAT, CUTOFF),
      next: span(CUTOFF, DEFAULT_NEXT_CUTOFF),
      defaultNext: span(CUTOFF, DEFAULT_NEXT_CUTOFF),
      currentDefaults: getPeriodDefaults(f.db),
      parties: [
        { id: f.tata, name: 'Táta', role: 'giver' },
        { id: f.starsi, name: 'Starší', role: 'taker' },
        { id: f.mladsi, name: 'Mladší', role: 'taker' },
      ],
    })
  })

  it('an agreed change makes next; defaultNext stays the default week', () => {
    const f = week()
    agreedNextWeek(f)
    const v = proposalsView(f.db, AT)
    expect(v.next).toEqual(span(CUTOFF, NEXT.cutoffAt, NEXT.levels))
    expect(v.defaultNext).toEqual(span(CUTOFF, DEFAULT_NEXT_CUTOFF))
  })

  it('a running week that ends on a Wednesday: defaultNext is the default rule, not 7 days', () => {
    const f = week()
    const wed = prague(2026, 12, 2, 23, 59)
    const { id } = must(proposePeriod(f.db, f.starsi, { cutoffAt: wed, levels: NEXT.levels }, AT))
    must(approveProposal(f.db, f.mladsi, 'period', id, AT))
    must(approveProposal(f.db, f.tata, 'period', id, AT))
    rollPeriods(f.db, CUTOFF, DEFAULT_PERIOD_DEFAULTS)
    const v = proposalsView(f.db, prague(2026, 12, 1, 12))
    expect(v.running).toEqual(span(CUTOFF, wed, NEXT.levels))
    // Sunday nearest Wed 9 Dec is Sun 6 Dec: 4 days, not addPragueDays(wed, 7).
    expect(v.defaultNext).toEqual(span(wed, DEFAULT_NEXT_CUTOFF))
    expect(v.defaultNext?.cutoffAt).not.toBe(addPragueDays(wed, 7).toISOString())
    expect(v.next).toEqual(v.defaultNext)
  })

  it('before the first roll: running, next and defaultNext are null', () => {
    const f = family()
    const v = proposalsView(f.db, AT)
    expect([v.running, v.next, v.defaultNext]).toEqual([null, null, null])
  })

  it('a second giver is a party', () => {
    const f = week()
    const mama = addGiver(f)
    expect(proposalsView(f.db, AT).parties.map((p) => p.id)).toEqual([
      f.tata,
      f.starsi,
      f.mladsi,
      mama,
    ])
  })
})
