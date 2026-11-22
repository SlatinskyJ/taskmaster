import { and, asc, eq, inArray } from 'drizzle-orm'
import {
  approveDefaults,
  approvePeriodSettings,
  isRunning,
  nextPeriod,
  periodAgreementWaitingFor,
  proposeDefaults,
  proposePeriodSettings,
  rejectPeriodProposal,
  resolvePeriodProposal,
  withdrawPeriodProposal,
} from '~/domain'
import type {
  DefaultsProposal,
  Person,
  PeriodDefaults,
  PeriodError,
  PeriodProposal,
  PeriodProposalStatus,
  PeriodSettings,
  PeriodSettingsProposal,
  PeriodSpan,
} from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Actor, Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import {
  defaultsProposalApprovals,
  defaultsProposals,
  periodProposalApprovals,
  periodProposals,
  periods,
  users,
} from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import { getPeriodDefaults, writePeriodDefaults } from './defaults'
import { agreedProposalFor, toDefaultsProposal, toPeriodProposal } from './proposalRows'
import type { Stored } from './proposalRows'
import { currentPeriod, toPeriod } from './periods'

// Proposals (spec §3 period agreement, §5.8): the write paths. The rules are the domain's; each
// call is one transaction with its audit entries. An agreed per-period change waits for its
// period to start (./periods.ts applies it); an agreed defaults change is stored at once through
// `writePeriodDefaults`, so periods already due roll first with the old values.

type Reader = Db | Tx

export type ProposalKind = 'period' | 'defaults'
export type ProposalError = PeriodError | 'not_found' | 'no_running_period'
export type ProposalOutcome = Result<{ id: number; status: PeriodProposalStatus }, ProposalError>

const PREFIX = { period: 'period', defaults: 'defaults' } as const
const ENTITY = { period: 'period_proposal', defaults: 'defaults_proposal' } as const
const TABLE = { period: periodProposals, defaults: defaultsProposals } as const
const APPROVALS = { period: periodProposalApprovals, defaults: defaultsProposalApprovals } as const

type Step = 'created' | 'approved' | 'agreed' | 'rejected' | 'withdrawn'

const state = (p: PeriodProposal<unknown>) => ({ status: p.status, approvedBy: [...p.approvedBy] })

function periodSettingsJson(s: PeriodSettings) {
  return {
    cutoffAt: toIsoUtc(s.cutoffAt),
    levels: { lower: s.levels.lower, upper: s.levels.upper },
  }
}

function defaultsJson(d: PeriodDefaults) {
  return {
    lengthDays: d.lengthDays,
    cutoff: { weekday: d.cutoff.weekday, hour: d.cutoff.hour, minute: d.cutoff.minute },
    levels: { lower: d.levels.lower, upper: d.levels.upper },
  }
}

function audit(
  tx: Tx,
  kind: ProposalKind,
  step: Step,
  actor: Actor,
  id: number,
  before: object | null,
  after: object,
  now: Date,
) {
  writeAudit(tx, {
    actor,
    action: `${PREFIX[kind]}.proposal_${step}`,
    entityType: ENTITY[kind],
    entityId: id,
    before,
    after,
    at: now,
  })
}

const user = (userId: number): Actor => ({ kind: 'user', userId })

/** Writes a proposal's new status (and closer) and its new approval, if any. */
function save(
  tx: Tx,
  kind: ProposalKind,
  before: Stored<PeriodProposal<unknown>>,
  after: PeriodProposal<unknown>,
  now: Date,
) {
  const at = toIsoUtc(now)
  if (after.status !== before.status) {
    const closed = after.status !== 'pending' && after.status !== 'agreed'
    tx.update(TABLE[kind])
      .set({ status: after.status, closedBy: after.closedBy, closedAt: closed ? at : null })
      .where(eq(TABLE[kind].id, before.id))
      .run()
  }
  for (const userId of after.approvedBy.filter((u) => !before.approvedBy.includes(u))) {
    tx.insert(APPROVALS[kind]).values({ proposalId: before.id, userId, approvedAt: at }).run()
  }
}

/**
 * On agreement: audit it; a defaults change is stored now. `before` is the state it moved from,
 * or null when it was agreed at creation (the `created` entry just before shows it).
 */
function onAgreed(
  tx: Tx,
  kind: ProposalKind,
  actor: Actor,
  before: PeriodProposal<unknown> | null,
  proposal: Stored<PeriodProposal<unknown>>,
  now: Date,
) {
  audit(tx, kind, 'agreed', actor, proposal.id, before && state(before), state(proposal), now)
  if (kind === 'defaults') {
    writePeriodDefaults(tx, actor, (proposal as Stored<DefaultsProposal>).settings, now)
  }
}

function load(tx: Tx, kind: ProposalKind, id: number): Stored<PeriodProposal<unknown>> | undefined {
  if (kind === 'period') {
    const row = tx.select().from(periodProposals).where(eq(periodProposals.id, id)).get()
    return row && toPeriodProposal(tx, row)
  }
  const row = tx.select().from(defaultsProposals).where(eq(defaultsProposals.id, id)).get()
  return row && toDefaultsProposal(tx, row)
}

const outcome = (id: number, status: PeriodProposalStatus): ProposalOutcome => ok({ id, status })

/** Any party proposes a different cutoff/levels for the period after the running one. */
export function proposePeriod(
  db: Db,
  userId: number,
  settings: PeriodSettings,
  now: Date,
): ProposalOutcome {
  return db.transaction((tx) => {
    const current = currentPeriod(tx, now)
    if (!current) return fail('no_running_period')
    const existing = tx
      .select()
      .from(periodProposals)
      .where(eq(periodProposals.afterPeriodId, current.id))
      .all()
      .map((r) => toPeriodProposal(tx, r))
    const r = proposePeriodSettings(listPeople(tx), userId, current, settings, existing, now)
    if (!r.ok) return r
    const row = tx
      .insert(periodProposals)
      .values({
        afterPeriodId: current.id,
        cutoffAt: toIsoUtc(settings.cutoffAt),
        lowerLevel: settings.levels.lower,
        upperLevel: settings.levels.upper,
        proposedBy: userId,
        status: r.value.status,
        createdAt: toIsoUtc(now),
      })
      .returning()
      .get()
    const stored = { ...r.value, id: row.id }
    tx.insert(periodProposalApprovals)
      .values({ proposalId: row.id, userId, approvedAt: toIsoUtc(now) })
      .run()
    const after = {
      ...state(stored),
      afterPeriodId: current.id,
      settings: periodSettingsJson(settings),
    }
    audit(tx, 'period', 'created', user(userId), row.id, null, after, now)
    if (stored.status === 'agreed') onAgreed(tx, 'period', user(userId), null, stored, now)
    return outcome(row.id, stored.status)
  })
}

/** A giver proposes new default-week settings. */
export function proposeDefaultsChange(
  db: Db,
  giverId: number,
  defaults: PeriodDefaults,
  now: Date,
): ProposalOutcome {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(defaultsProposals)
      .where(eq(defaultsProposals.status, 'pending'))
      .all()
      .map((r) => toDefaultsProposal(tx, r))
    const r = proposeDefaults(listPeople(tx), giverId, defaults, existing)
    if (!r.ok) return r
    const row = tx
      .insert(defaultsProposals)
      .values({
        lengthDays: defaults.lengthDays,
        cutoffWeekday: defaults.cutoff.weekday,
        cutoffHour: defaults.cutoff.hour,
        cutoffMinute: defaults.cutoff.minute,
        lowerLevel: defaults.levels.lower,
        upperLevel: defaults.levels.upper,
        proposedBy: giverId,
        status: r.value.status,
        createdAt: toIsoUtc(now),
      })
      .returning()
      .get()
    const stored = { ...r.value, id: row.id }
    tx.insert(defaultsProposalApprovals)
      .values({ proposalId: row.id, userId: giverId, approvedAt: toIsoUtc(now) })
      .run()
    const after = { ...state(stored), settings: defaultsJson(defaults) }
    audit(tx, 'defaults', 'created', user(giverId), row.id, null, after, now)
    if (stored.status === 'agreed') onAgreed(tx, 'defaults', user(giverId), null, stored, now)
    return outcome(row.id, stored.status)
  })
}

/** The period a per-period proposal follows, as the domain needs it for its time checks. */
function afterPeriod(tx: Tx, proposal: Stored<PeriodSettingsProposal>) {
  const row = tx.select().from(periods).where(eq(periods.id, proposal.afterPeriodId)).get()
  if (!row) throw new Error('proposal without its period')
  return toPeriod(row)
}

/** A party approves; reaching period agreement is audited, and stores a defaults change. */
export function approveProposal(
  db: Db,
  userId: number,
  kind: ProposalKind,
  id: number,
  now: Date,
): ProposalOutcome {
  return db.transaction((tx) => {
    const before = load(tx, kind, id)
    if (!before) return fail('not_found')
    const people = listPeople(tx)
    const r =
      kind === 'period'
        ? approvePeriodSettings(
            before as Stored<PeriodSettingsProposal>,
            people,
            userId,
            afterPeriod(tx, before as Stored<PeriodSettingsProposal>),
            now,
          )
        : approveDefaults(before as Stored<DefaultsProposal>, people, userId)
    if (!r.ok) return r
    const after = { ...r.value, id }
    save(tx, kind, before, after, now)
    audit(tx, kind, 'approved', user(userId), id, state(before), state(after), now)
    if (after.status === 'agreed') onAgreed(tx, kind, user(userId), before, after, now)
    return outcome(id, after.status)
  })
}

function close(
  db: Db,
  userId: number,
  kind: ProposalKind,
  id: number,
  now: Date,
  step: 'rejected' | 'withdrawn',
): ProposalOutcome {
  return db.transaction((tx) => {
    const before = load(tx, kind, id)
    if (!before) return fail('not_found')
    const r =
      step === 'rejected'
        ? rejectPeriodProposal(before, listPeople(tx), userId)
        : withdrawPeriodProposal(before, userId)
    if (!r.ok) return r
    save(tx, kind, before, r.value, now)
    audit(tx, kind, step, user(userId), id, state(before), state(r.value), now)
    return outcome(id, r.value.status)
  })
}

/** Any party rejects a pending proposal; it closes ([call] one no ends it). */
export function rejectProposal(db: Db, userId: number, kind: ProposalKind, id: number, now: Date) {
  return close(db, userId, kind, id, now, 'rejected')
}

/** The proposer withdraws a pending proposal. */
export function withdrawProposal(
  db: Db,
  userId: number,
  kind: ProposalKind,
  id: number,
  now: Date,
) {
  return close(db, userId, kind, id, now, 'withdrawn')
}

/**
 * People-change hook (spec §3): a role change can give a pending proposal period agreement with
 * no new approval. Promotes it, audited by the system; a defaults change is stored. A per-period
 * proposal whose period has already started is left pending for the lapse (spec §5.8).
 */
export function resolvePendingProposals(tx: Tx, people: Person[], now: Date): void {
  const system: Actor = { kind: 'system' }
  for (const row of tx
    .select()
    .from(periodProposals)
    .where(eq(periodProposals.status, 'pending'))
    .all()) {
    const before = toPeriodProposal(tx, row)
    if (!isRunning(afterPeriod(tx, before), now)) continue
    const after = { ...resolvePeriodProposal(before, people), id: row.id }
    if (after.status !== 'agreed') continue
    save(tx, 'period', before, after, now)
    onAgreed(tx, 'period', system, before, after, now)
  }
  for (const row of tx
    .select()
    .from(defaultsProposals)
    .where(eq(defaultsProposals.status, 'pending'))
    .all()) {
    const before = toDefaultsProposal(tx, row)
    const after = { ...resolvePeriodProposal(before, people), id: row.id }
    if (after.status !== 'agreed') continue
    save(tx, 'defaults', before, after, now)
    onAgreed(tx, 'defaults', system, before, after, now)
  }
}

export interface ProposalView<S> {
  id: number
  settings: S
  proposedBy: number
  approvedBy: number[]
  status: PeriodProposalStatus
  /** Who still has to approve, by id: takers who have not, and every giver while none has. */
  waitingFor: number[]
}

export interface SpanView {
  startsAt: string
  cutoffAt: string
  levels: { lower: number; upper: number }
}

export interface Party {
  id: number
  name: string
  role: 'taker' | 'giver'
}

export interface ProposalsView {
  period: ProposalView<{ cutoffAt: string; levels: { lower: number; upper: number } }> | null
  defaults: ProposalView<PeriodDefaults> | null
  /** The running week, or null before the first roll (or between a cutoff and its roll). */
  running: SpanView | null
  /** Next week as it starts now: the agreed change if there is one, else the default week. */
  next: SpanView | null
  /** Next week as the default week alone would make it, even when a change is agreed. */
  defaultNext: SpanView | null
  /** The stored default week. */
  currentDefaults: PeriodDefaults
  /** Every active taker and giver, by id: who the screens name. No admin, no usernames. */
  parties: Party[]
}

const spanView = (s: PeriodSpan): SpanView => ({
  startsAt: toIsoUtc(s.startsAt),
  cutoffAt: toIsoUtc(s.cutoffAt),
  levels: { lower: s.levels.lower, upper: s.levels.upper },
})

function listParties(db: Reader): Party[] {
  return db
    .select({ id: users.id, name: users.displayName, role: users.role })
    .from(users)
    .where(and(eq(users.active, true), inArray(users.role, ['taker', 'giver'])))
    .orderBy(asc(users.id))
    .all()
    .map((u) => ({ id: u.id, name: u.name, role: u.role === 'giver' ? 'giver' : 'taker' }))
}

/** What a party sees: the open change for next week, and the pending default-week change. */
export function proposalsView(db: Reader, now: Date): ProposalsView {
  const people = listPeople(db)
  const current = currentPeriod(db, now)
  const periodRow = current
    ? db
        .select()
        .from(periodProposals)
        .where(
          and(
            eq(periodProposals.afterPeriodId, current.id),
            inArray(periodProposals.status, ['pending', 'agreed']),
          ),
        )
        .orderBy(asc(periodProposals.id))
        .get()
    : undefined
  const defaultsRow = db
    .select()
    .from(defaultsProposals)
    .where(eq(defaultsProposals.status, 'pending'))
    .get()
  const p = periodRow && toPeriodProposal(db, periodRow)
  const d = defaultsRow && toDefaultsProposal(db, defaultsRow)
  const currentDefaults = getPeriodDefaults(db)
  const agreed = current ? agreedProposalFor(db, current.id) : null
  return {
    running: current ? spanView(current) : null,
    next: current ? spanView(nextPeriod(current, currentDefaults, agreed)) : null,
    defaultNext: current ? spanView(nextPeriod(current, currentDefaults, null)) : null,
    currentDefaults,
    parties: listParties(db),
    period: p
      ? {
          id: p.id,
          settings: periodSettingsJson(p.settings),
          proposedBy: p.proposedBy,
          approvedBy: [...p.approvedBy],
          status: p.status,
          waitingFor: periodAgreementWaitingFor(p.approvedBy, people),
        }
      : null,
    defaults: d
      ? {
          id: d.id,
          settings: defaultsJson(d.settings),
          proposedBy: d.proposedBy,
          approvedBy: [...d.approvedBy],
          status: d.status,
          waitingFor: periodAgreementWaitingFor(d.approvedBy, people),
        }
      : null,
  }
}
