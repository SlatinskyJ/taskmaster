import { and, asc, desc, eq } from 'drizzle-orm'
import {
  approveTemplate,
  findPerson,
  isValidScore,
  liveBook,
  liveTemplateBook,
  missingRoles,
  proposeTemplate,
  resolveTemplate,
  validateTemplateDefinition,
} from '~/domain'
import type {
  AgreementError,
  ClockTime,
  DeadlineRule,
  Person,
  TemplateAgreement,
  TemplateDefinitionError,
  TemplateSchedule,
} from '~/domain'
import type { Weekday } from '~/domain/dates'
import { toIsoUtc } from '~/domain/dates'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { normaliseTitle } from '~/lib/taskLimits'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { templates, templateScoreApprovals, users } from '~/server/db/schema'
import type { TemplateRow, TemplateStatus } from '~/server/db/schema'
import type { ThreadEntry } from '~/server/threadEntry'
import { listPeople } from '~/server/users/people'
import { closeThread, lastBids, markBidsFrom, openRows, threadOf } from './thread'

// Recurring templates and their first score agreement (spec §5.1, §5.3). The rules live in
// src/domain (agreement + templates); this module loads the rows, asks the domain, and writes
// the result with its audit entries in one transaction. Score changes after agreement: ./scoreChange.

export type TemplateError = AgreementError | TemplateDefinitionError | 'invalid_title' | 'not_found'

export interface NewTemplate {
  title: string
  score: number
  approvalRequired: boolean
  schedule: TemplateSchedule | null
  deadline: DeadlineRule | null
}

// ── Storage helpers ─────────────────────────────────────────────────────────────────────

const daysToMask = (days: readonly Weekday[]) =>
  days.reduce<number>((mask, d) => mask | (1 << d), 0)

function maskToDays(mask: number): Weekday[] {
  const days: Weekday[] = []
  for (let d = 0; d <= 6; d++) if (mask & (1 << d)) days.push(d as Weekday)
  return days
}

const pad = (n: number) => String(n).padStart(2, '0')
const toHhMm = (t: ClockTime) => `${pad(t.hour)}:${pad(t.minute)}`

// ── Agreement ───────────────────────────────────────────────────────────────────────────

/** Approvals of a proposed template's offer round `offerRound`, oldest first (its offerer first). */
function approvers(db: Db | Tx, templateId: number, offerRound: number): number[] {
  return db
    .select({ userId: templateScoreApprovals.userId })
    .from(templateScoreApprovals)
    .where(
      and(
        eq(templateScoreApprovals.templateId, templateId),
        eq(templateScoreApprovals.offerRound, offerRound),
      ),
    )
    .orderBy(asc(templateScoreApprovals.approvedAt), asc(templateScoreApprovals.userId))
    .all()
    .map((r) => r.userId)
}

/**
 * The domain's view: stored `active` is the domain's `agreed`, with the score change in flight
 * read from the open thread rows (null when none are open).
 */
export function agreementOf(db: Db | Tx, row: TemplateRow): TemplateAgreement {
  const last = (since: number) =>
    lastBids(db, row.id, since).map((r) => ({ by: r.userId, score: r.score }))
  if (row.status === 'active') {
    const rows = openRows(db, row.id)
    // Each taker's last bid since bids last reset (#232): the same number is refused again.
    const lastBids = last(row.bidsFrom)
    if (rows.length === 0) return { status: 'agreed', score: row.score, change: null, lastBids }
    const offer = rows.find((r) => r.side === 'giver')
    return {
      status: 'agreed',
      score: row.score,
      lastBids,
      change: {
        offer: offer ? { score: offer.score, proposedBy: offer.userId } : null,
        bids: rows.filter((r) => r.side === 'taker').map((r) => ({ by: r.userId, score: r.score })),
      },
    }
  }
  // A proposed template (#209): the offer is `templates.score`, made by the newest giver row's
  // author (a counter or a turn-down) or else the creator; bids are the open taker rows.
  const rows = openRows(db, row.id)
  const offer = rows.find((r) => r.side === 'giver')
  const bids = (list: { userId: number; score: number }[]) =>
    list.map((r) => ({ by: r.userId, score: r.score }))
  return {
    status: 'proposed',
    proposal: {
      score: row.score,
      proposedBy: offer?.userId ?? row.createdBy,
      approvedBy: approvers(db, row.id, row.offerRound),
    },
    book: { bids: bids(rows.filter((r) => r.side === 'taker')) },
    lastBids: last(row.bidsFrom),
  }
}

/**
 * The one writer of approvals (#209): `userId` approves the template's current offer, in its
 * current offer round. Append-only; a new round gets new rows.
 */
export function approveIn(tx: Tx, row: TemplateRow, userId: number, now: Date): void {
  tx.insert(templateScoreApprovals)
    .values({
      templateId: row.id,
      userId,
      score: row.score,
      offerRound: row.offerRound,
      approvedAt: toIsoUtc(now),
    })
    .run()
}

/** How a proposed template got agreed (#209): the `by` of its `template.agreed` entry. */
export type AgreedBy = 'approval' | 'bid' | 'offer' | 'counter'

/**
 * A proposed template is agreed at `score`: it turns active, every open thread row closes
 * (`accepted` for `acceptedIds`, #209), and `template.agreed` names them. Only touches it while
 * still proposed; returns undefined otherwise. `replaced`: the offer row a counter just replaced.
 */
export function agreeIn(
  tx: Tx,
  row: TemplateRow,
  score: number,
  acceptedIds: readonly number[],
  by: AgreedBy,
  actor: Parameters<typeof writeAudit>[1]['actor'],
  now: Date,
  replaced: { id: number; score: number } | null = null,
): TemplateRow | undefined {
  const at = toIsoUtc(now)
  const active = tx
    .update(templates)
    .set({ status: 'active', score, agreedAt: at, updatedAt: at })
    .where(and(eq(templates.id, row.id), eq(templates.status, 'proposed')))
    .returning()
    .all()
    .at(0)
  if (!active) return undefined
  const { accepted, closed } = closeThread(tx, row.id, acceptedIds, now)
  // An agreement resets bids (#232): no first-price bid blocks its number in a later change.
  const floor = markBidsFrom(tx, row.id)
  writeAudit(tx, {
    actor,
    action: 'template.agreed',
    entityType: 'template',
    entityId: row.id,
    before: {
      status: 'proposed',
      score: row.score,
      // A counter that agreed replaced the open offer row before the thread closed (§5.10).
      ...(replaced && { replacedOffer: { entryId: replaced.id, score: replaced.score } }),
      bidsFrom: floor.before,
    },
    after: {
      status: 'active',
      score,
      by,
      entryIds: accepted,
      closedIds: closed,
      bidsFrom: floor.after,
    },
    at: now,
  })
  return active
}

/** The open offer row of a proposed template, as the ids an agreement at the offer accepts. */
export const offerRowIds = (tx: Tx, templateId: number) =>
  openRows(tx, templateId)
    .filter((r) => r.side === 'giver')
    .map((r) => r.id)

/** A giver creates a template with a proposed score (spec §5.1). It starts proposed. */
export function createTemplate(
  db: Db,
  giverId: number,
  input: NewTemplate,
  now: Date = new Date(),
): Result<TemplateRow, TemplateError> {
  return db.transaction((tx) => createTemplateIn(tx, giverId, input, now))
}

/** `createTemplate` inside a caller's transaction (the demo seed). */
export function createTemplateIn(
  tx: Tx,
  giverId: number,
  input: NewTemplate,
  now: Date,
): Result<TemplateRow, TemplateError> {
  const title = normaliseTitle(input.title)
  if (!title) return fail('invalid_title')
  if (!isValidScore(input.score)) return fail('invalid_score')
  const def = validateTemplateDefinition({ schedule: input.schedule, deadline: input.deadline })
  if (!def.ok) return def
  const people = listPeople(tx)
  const agreement = proposeTemplate(people, giverId, input.score)
  if (!agreement.ok) return agreement
  const { schedule, deadline } = def.value
  const at = toIsoUtc(now)
  // A giver's proposal alone never agrees (it needs a taker), so the template starts proposed.
  const row = tx
    .insert(templates)
    .values({
      title,
      status: agreement.value.status === 'agreed' ? 'active' : 'proposed',
      score: input.score,
      approvalRequired: input.approvalRequired,
      scheduleDays: schedule ? daysToMask(schedule.days) : 0,
      scheduleTime: schedule?.time ? toHhMm(schedule.time) : null,
      dueDayOffset: deadline?.dayOffset ?? null,
      dueTime: deadline ? toHhMm(deadline.due) : null,
      graceMinutes: deadline?.graceMinutes ?? null,
      createdBy: giverId,
      createdAt: at,
      updatedAt: at,
      agreedAt: agreement.value.status === 'agreed' ? at : null,
    })
    .returning()
    .get()
  approveIn(tx, row, giverId, now)
  writeAudit(tx, {
    actor: { kind: 'user', userId: giverId },
    action: 'template.created',
    entityType: 'template',
    entityId: row.id,
    after: row,
    at: now,
  })
  return ok(row)
}

/**
 * A party approves a proposed template's score (spec §3). `score` is the score the person saw;
 * a different stored score is refused. Once a current giver and taker approved, it is active.
 */
export function approveTemplateScore(
  db: Db,
  userId: number,
  templateId: number,
  score: number,
  now: Date = new Date(),
): Result<TemplateRow, TemplateError> {
  return db.transaction((tx) => approveTemplateScoreIn(tx, userId, templateId, score, now))
}

/** `approveTemplateScore` inside a caller's transaction (the demo seed). */
export function approveTemplateScoreIn(
  tx: Tx,
  userId: number,
  templateId: number,
  score: number,
  now: Date,
): Result<TemplateRow, TemplateError> {
  const row = tx.select().from(templates).where(eq(templates.id, templateId)).get()
  if (!row) return fail('not_found')
  if (row.status !== 'proposed') return fail('not_proposed')
  if (row.score !== score) return fail('offer_changed')
  const result = approveTemplate(agreementOf(tx, row), listPeople(tx), userId)
  if (!result.ok) return result
  approveIn(tx, row, userId, now)
  const actor = { kind: 'user', userId } as const
  writeAudit(tx, {
    actor,
    action: 'template.score_approved',
    entityType: 'template',
    entityId: templateId,
    after: { score, offerRound: row.offerRound },
    at: now,
  })
  if (result.value.status !== 'agreed') return ok(row)
  // Agreed at the offer: its row (a counter, a re-offer) is accepted, open bids close (#209).
  const active = agreeIn(tx, row, score, offerRowIds(tx, templateId), 'approval', actor, now)
  // Unreachable: the status check above runs in this same synchronous transaction. Throwing rolls
  // back the approval row and its audit entry, so a failure never leaves half a write.
  if (!active) throw new Error(`template ${String(templateId)} left proposed mid-transaction`)
  return ok(active)
}

/**
 * People changed (spec §3 caller duty): approvals count live, so a proposed template may now be
 * agreed. Activates those, logged as the system. Runs inside the change's transaction.
 */
export function resolveProposedTemplates(tx: Tx, people: Person[], now: Date): void {
  const proposed = tx.select().from(templates).where(eq(templates.status, 'proposed')).all()
  for (const row of proposed) {
    if (resolveTemplate(agreementOf(tx, row), people).status !== 'agreed') continue
    agreeIn(tx, row, row.score, offerRowIds(tx, row.id), 'approval', { kind: 'system' }, now)
  }
}

// ── Reads for screens ───────────────────────────────────────────────────────────────────

/** A template as a screen shows it. */
export interface TemplateView {
  id: number
  title: string
  status: TemplateStatus
  score: number
  approvalRequired: boolean
  createdByName: string
  /** Proposed only: display names of who approved, oldest first. */
  approvedBy: string[]
  /** `time` is Prague `HH:MM`, or null = start of the day. Null schedule = on demand only. */
  schedule: { days: Weekday[]; time: string | null } | null
  /** `due` is Prague `HH:MM`. */
  deadline: { dayOffset: number; due: string; graceMinutes: number } | null
  /** Agreed with a score change in flight (spec §5.1), else null. */
  change: TemplateChangeView | null
  /** Proposed only: the first-price bidding (#209), else null. */
  bidding: TemplateBiddingView | null
  /**
   * Agreed only: each taker's last bid since bids last reset or the offer last changed, open or
   * withdrawn (#232): the same number is refused again. Empty for a proposed chore (see bidding).
   */
  lastBids: { takerId: number; score: number }[]
}

/** A score change as screens show it: current takers' bids only (live), lowest first. */
export interface TemplateChangeView {
  offer: { score: number; byName: string } | null
  bids: { takerId: number; name: string; score: number }[]
  /** The lowest live bid: what a giver's accept sends back. Null with no bids. */
  lowest: number | null
}

/**
 * A proposed template's first-price bidding (#209): the current offer, live bids lowest first,
 * and each taker's last bid since the offer last changed (the same number is refused again).
 */
export type TemplateBiddingView = TemplateChangeView & {
  lastBids: { takerId: number; score: number }[]
}

function biddingView(
  agreement: TemplateAgreement,
  people: Person[],
  name: (id: number) => string,
): TemplateBiddingView | null {
  if (agreement.status !== 'proposed') return null
  const { proposal, lastBids: last } = agreement
  const live = [...liveBook(agreement.book, people).bids].sort((a, b) => a.score - b.score)
  return {
    offer: { score: proposal.score, byName: name(proposal.proposedBy) },
    bids: live.map((b) => ({ takerId: b.by, name: name(b.by), score: b.score })),
    lowest: live[0]?.score ?? null,
    lastBids: last.map((b) => ({ takerId: b.by, score: b.score })),
  }
}

function agreedLastBids(agreement: TemplateAgreement): TemplateView['lastBids'] {
  if (agreement.status !== 'agreed') return []
  return (agreement.lastBids ?? []).map((b) => ({ takerId: b.by, score: b.score }))
}

function changeView(
  agreement: TemplateAgreement,
  people: Person[],
  name: (id: number) => string,
): TemplateChangeView | null {
  if (agreement.status !== 'agreed' || !agreement.change) return null
  const { offer, bids } = liveTemplateBook(agreement.change, people)
  // Bids are oldest first; a stable sort keeps that order among equal scores.
  const live = [...bids].sort((a, b) => a.score - b.score)
  return {
    offer: offer ? { score: offer.score, byName: name(offer.proposedBy) } : null,
    bids: live.map((b) => ({ takerId: b.by, name: name(b.by), score: b.score })),
    lowest: live[0]?.score ?? null,
  }
}

const nameMap = (db: Db | Tx) =>
  new Map(
    db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .all()
      .map((u) => [u.id, u.name]),
  )

/** The stored schedule as the domain's `TemplateSchedule`, or null when there is none. */
export function scheduleOf(row: TemplateRow): TemplateSchedule | null {
  if (row.scheduleDays === 0) return null
  const [hour = 0, minute = 0] = (row.scheduleTime ?? '').split(':').map(Number)
  return { days: maskToDays(row.scheduleDays), time: row.scheduleTime ? { hour, minute } : null }
}

/** A template row's deadline rule for the domain (`dueTime` is stored as "HH:MM"), or null. */
export function deadlineRuleOf(row: TemplateRow): DeadlineRule | null {
  if (row.dueDayOffset === null || row.dueTime === null || row.graceMinutes === null) return null
  const [hour = 0, minute = 0] = row.dueTime.split(':').map(Number)
  return { dayOffset: row.dueDayOffset, due: { hour, minute }, graceMinutes: row.graceMinutes }
}

/**
 * The launch switches a read or an action follows. Off by default. `choreBidding` (#209): bidding
 * on a proposed chore's first price; `bidRefusals` (#232): Nechci and turn-down on a price change.
 */
export interface BiddingOpts {
  choreBidding: boolean
  bidRefusals: boolean
}
const BIDDING_OFF: BiddingOpts = { choreBidding: false, bidRefusals: false }

/** With `choreBidding` off a proposed template has `bidding: null`: no screen offers bidding. */
function views(db: Db | Tx, rows: TemplateRow[], opts: BiddingOpts): TemplateView[] {
  if (rows.length === 0) return []
  const names = nameMap(db)
  const people = listPeople(db)
  return rows.map((t) => viewOf(db, t, agreementOf(db, t), people, names, opts))
}

function viewOf(
  db: Db | Tx,
  t: TemplateRow,
  agreement: TemplateAgreement,
  people: Person[],
  names: Map<number, string>,
  opts: BiddingOpts,
): TemplateView {
  const name = (id: number) => names.get(id) ?? ''
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    score: t.score,
    approvalRequired: t.approvalRequired,
    createdByName: names.get(t.createdBy) ?? '',
    approvedBy:
      t.status === 'proposed'
        ? approvers(db, t.id, t.offerRound).map((id) => names.get(id) ?? '')
        : [],
    schedule:
      t.scheduleDays === 0 ? null : { days: maskToDays(t.scheduleDays), time: t.scheduleTime },
    deadline:
      t.dueDayOffset === null || t.dueTime === null || t.graceMinutes === null
        ? null
        : { dayOffset: t.dueDayOffset, due: t.dueTime, graceMinutes: t.graceMinutes },
    change: changeView(agreement, people, name),
    bidding: opts.choreBidding ? biddingView(agreement, people, name) : null,
    lastBids: agreedLastBids(agreement),
  }
}

/**
 * Templates for the Úkoly screen, newest first. A giver sees every template; anyone else only
 * agreed ones (proposed ones reach takers through "Čeká na tebe").
 */
export function listTemplates(
  db: Db | Tx,
  viewerId: number,
  opts: BiddingOpts = BIDDING_OFF,
): TemplateView[] {
  const viewer = findPerson(listPeople(db), viewerId)
  const query = db.select().from(templates)
  const rows =
    viewer?.role === 'giver'
      ? query.orderBy(desc(templates.id)).all()
      : query.where(eq(templates.status, 'active')).orderBy(desc(templates.id)).all()
  return views(db, rows, opts)
}

/** A template with its whole score change history (spec §5.1: every bid is kept). */
export interface TemplateDetail {
  template: TemplateView
  thread: ThreadEntry[]
  /** Who may still agree to a proposed template; any one of them per missing side (#205). */
  waitingFor: { id: number; name: string }[]
}

/**
 * The price page of a template, or null: unknown id, or a viewer who is not a party (the admin).
 * A proposed one shows to the brothers too when a switch lets them reach it: with `openRows`
 * they agree to it there (spec §5.1, #205), with `choreBidding` they bid on its first price (#209).
 */
export function getTemplateDetail(
  db: Db | Tx,
  templateId: number,
  viewerId: number,
  opts: BiddingOpts = BIDDING_OFF,
  openRows = false,
): TemplateDetail | null {
  const row = db.select().from(templates).where(eq(templates.id, templateId)).get()
  if (!row) return null
  const viewer = findPerson(listPeople(db), viewerId)
  if (viewer?.role !== 'giver' && viewer?.role !== 'taker') return null
  const takerMay = opts.choreBidding || openRows
  if (row.status === 'proposed' && viewer.role === 'taker' && !takerMay) return null
  const [template] = views(db, [row], opts)
  if (!template) return null
  const names = nameMap(db)
  const thread = threadOf(db, templateId).map((e): ThreadEntry => ({
    id: e.id,
    side: e.side,
    by: { id: e.userId, name: names.get(e.userId) ?? '' },
    score: e.score,
    at: e.createdAt,
    state: e.closedAs ?? 'open',
  }))
  const waitingFor = templateWaitsFor(db, row, listPeople(db)).map((p) => ({
    id: p.id,
    name: names.get(p.id) ?? '',
  }))
  return { template, thread, waitingFor }
}

/**
 * "Čeká na tebe": agreed templates whose score change waits for this person's side. A taker
 * when the givers' offer is open (any taker may accept it); a giver when live bids are open. With
 * `choreBidding` a giver also gets proposed templates with live bids, after the agreed ones (#209).
 */
export function pendingTemplatePriceChanges(
  db: Db | Tx,
  userId: number,
  opts: BiddingOpts = BIDDING_OFF,
): TemplateView[] {
  const me = findPerson(listPeople(db), userId)
  if (!me || me.role === 'admin') return []
  const role = me.role
  const agreed = db
    .select()
    .from(templates)
    .where(eq(templates.status, 'active'))
    .orderBy(asc(templates.id))
    .all()
  const changes = views(db, agreed, opts).filter((t) =>
    role === 'taker' ? t.change?.offer != null : (t.change?.bids.length ?? 0) > 0,
  )
  if (role !== 'giver' || !opts.choreBidding) return changes
  const proposed = db
    .select()
    .from(templates)
    .where(eq(templates.status, 'proposed'))
    .orderBy(asc(templates.id))
    .all()
  return [...changes, ...views(db, proposed, opts).filter((t) => (t.bidding?.bids.length ?? 0) > 0)]
}

/**
 * Who may still agree to a proposed template: the active people of each side that has no yes
 * yet, minus those who said yes. Empty once it is agreed. Domů and the price page share it.
 */
export function templateWaitsFor(
  db: Db | Tx,
  row: TemplateRow,
  people: readonly Person[],
): Person[] {
  if (row.status !== 'proposed') return []
  const agreement = agreementOf(db, row)
  if (agreement.status !== 'proposed') return []
  const { proposal } = agreement
  const missing = missingRoles(proposal, people)
  return people.filter(
    (p) =>
      p.active &&
      p.role !== 'admin' &&
      missing.includes(p.role) &&
      !proposal.approvedBy.includes(p.id),
  )
}

/**
 * "Čeká na tebe": proposed templates that still need this person's side and that they haven't
 * approved. Takers see every new one; a giver only when no current giver has approved.
 */
export function pendingTemplateApprovals(
  db: Db | Tx,
  userId: number,
  opts: BiddingOpts = BIDDING_OFF,
): TemplateView[] {
  const people = listPeople(db)
  const me = findPerson(people, userId)
  if (!me || me.role === 'admin' || !me.active) return []
  const proposed = db
    .select()
    .from(templates)
    .where(eq(templates.status, 'proposed'))
    .orderBy(asc(templates.id))
    .all()
  const waiting = proposed.filter((row) =>
    templateWaitsFor(db, row, people).some((p) => p.id === userId),
  )
  return views(db, waiting, opts)
}
