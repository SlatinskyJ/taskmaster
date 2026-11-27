import { and, asc, eq } from 'drizzle-orm'
import type { AuditAction, AuditLogRow } from '~/server/audit'
import type { Db } from '~/server/db'
import {
  auditLog,
  disputes,
  pointAdjustments,
  settlementCorrections,
  settlements,
  suggestions,
  tasks,
  templates,
} from '~/server/db/schema'
import { loadTarget } from '~/server/disputes/targets'
import { idTopic } from './topics'
import type { Topic } from './topics'

// Audit entry → topics (#299): the one place that says which screens a change touches (design
// "The change side"; table in the plan and ./README.md). It reads the entity's current row, which
// may have changed or be gone since the entry was written; over-firing is accepted, a miss is
// not (design "Topics"). Topic rule: ./topics.ts.

/**
 * Every audit action, mapped (`none`: no screen shows it, or Jakub put it out of scope: logins,
 * passkeys, launch switch flips). A new action without a row here fails typecheck and the test.
 */
export const MAPPED: Record<AuditAction, 'topics' | 'none'> = {
  'auth.login_succeeded': 'none',
  'auth.login_failed': 'none',
  'auth.logout': 'none',
  'auth.password_change_failed': 'none',
  'passkey.registered': 'none',
  'passkey.removed': 'none',
  'user.created': 'topics',
  'user.updated': 'topics',
  'settings.changed': 'topics',
  'feature.switched': 'none',
  'task.created': 'topics',
  'task.score_offered': 'topics',
  'task.score_countered': 'topics',
  'task.bid_placed': 'topics',
  'task.bid_accepted': 'topics',
  'task.bid_withdrawn': 'topics',
  'task.bids_turned_down': 'topics',
  'task.bidding_reopened': 'topics',
  'task.bidding_closed': 'topics',
  'task.score_approved': 'topics',
  'task.score_change_proposed': 'topics',
  'task.score_changed': 'topics',
  'task.score_change_approved': 'topics',
  'task.score_change_declined': 'topics',
  'task.score_change_withdrawn': 'topics',
  'task.score_change_discarded': 'topics',
  'task.agreed': 'topics',
  'task.reserved': 'topics',
  'task.released': 'topics',
  'task.completed': 'topics',
  'task.approved': 'topics',
  'task.rejected': 'topics',
  'task.cancelled': 'topics',
  'task.description_changed': 'topics',
  'task.description_change_proposed': 'topics',
  'task.description_change_approved': 'topics',
  'task.description_change_declined': 'topics',
  'task.description_change_withdrawn': 'topics',
  'task.description_change_discarded': 'topics',
  'template.created': 'topics',
  'template.score_approved': 'topics',
  'template.score_change_proposed': 'topics',
  'template.bid_placed': 'topics',
  'template.score_countered': 'topics',
  'template.bid_withdrawn': 'topics',
  'template.bids_turned_down': 'topics',
  'template.score_changed': 'topics',
  'template.agreed': 'topics',
  'template.updated': 'topics',
  'template.cancelled': 'topics',
  'template.description_changed': 'topics',
  'template.description_change_proposed': 'topics',
  'template.description_change_approved': 'topics',
  'template.description_change_declined': 'topics',
  'template.description_change_withdrawn': 'topics',
  'instance.created': 'topics',
  'instance.self_logged': 'topics',
  'instance.reserved': 'topics',
  'instance.released': 'topics',
  'instance.completed': 'topics',
  'instance.approved': 'topics',
  'instance.rejected': 'topics',
  'instance.expired': 'topics',
  'instance.cancelled': 'topics',
  'instance.week_rules_dropped': 'topics',
  'period.created': 'topics',
  'period.ended': 'topics',
  'period.proposal_created': 'topics',
  'period.proposal_approved': 'topics',
  'period.proposal_rejected': 'topics',
  'period.proposal_withdrawn': 'topics',
  'period.proposal_agreed': 'topics',
  'period.proposal_lapsed': 'topics',
  'defaults.proposal_created': 'topics',
  'defaults.proposal_approved': 'topics',
  'defaults.proposal_rejected': 'topics',
  'defaults.proposal_withdrawn': 'topics',
  'defaults.proposal_agreed': 'topics',
  'settlement.created': 'topics',
  'settlement.corrected': 'topics',
  'points.adjusted': 'topics',
  'dispute.opened': 'topics',
  'dispute.corrected': 'topics',
  'dispute.dismissed': 'topics',
  'suggestion.created': 'topics',
  'suggestion.sent': 'topics',
  'suggestion.done': 'topics',
  'suggestion.dismissed': 'topics',
}

/** Entities no screen shows: settings.changed on `app_meta`, logins on `session`. */
const SILENT_ENTITIES = new Set<string>(['app_meta', 'session'])

const points = (id: number): Topic => idTopic('points', id)

/**
 * A per-taker fact (a settlement, an adjustment, a dispute or correction of one) goes only on
 * `points:<taker>`, never on `week`: both boys hold `week`, so it would tell one about his
 * brother (topics.ts). Without a taker (its row gone) it falls back to `week` so the change is
 * not missed; that can't happen in practice, as settlements and adjustments are never deleted.
 */
function takerFact(out: Set<Topic>, taker: number | null): void {
  out.add(taker === null ? 'week' : points(taker))
}

function idOf(entityId: string): number | null {
  const n = Number(entityId)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

function json(text: string | null): Record<string, unknown> {
  if (text === null) return {}
  try {
    const v: unknown = JSON.parse(text)
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** A positive integer id from a JSON value, else null. */
function userIdIn(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null
}

function taskTopics(db: Db, row: AuditLogRow, id: number, out: Set<Topic>): void {
  out.add(idTopic('task', id)).add('tasks').add('week')
  const t = db.select().from(tasks).where(eq(tasks.id, id)).get()
  const users: unknown[] = [t?.reservedBy, t?.completedBy, t?.earnerId]
  for (const side of [json(row.before), json(row.after)]) users.push(side.reservedBy, side.earnerId)
  for (const u of users) {
    const userId = userIdIn(u)
    if (userId !== null) out.add(points(userId))
  }
  if (t?.templateId != null) out.add(idTopic('template', t.templateId))
}

/**
 * Whether the entry was written while the template was proposed (only those who may see
 * proposed templates get it), after its agreement (everyone with `templates`), or is the
 * agreement itself (both). Read from the log, not the row: the row only says what it is now.
 */
function templateEra(db: Db, row: AuditLogRow, id: number): { proposed: boolean; listed: boolean } {
  const t = db
    .select({ status: templates.status })
    .from(templates)
    .where(eq(templates.id, id))
    .get()
  // Gone or unknown: proposed only, the narrower audience.
  if (!t) return { proposed: true, listed: false }
  if (t.status === 'proposed') return { proposed: true, listed: false }
  const agreed = db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, 'template.agreed'),
        eq(auditLog.entityType, 'template'),
        eq(auditLog.entityId, String(id)),
      ),
    )
    .orderBy(asc(auditLog.id))
    .get()
  if (!agreed) {
    // Active with no agreement entry (made agreed): proposed only if the entry says it was.
    return { proposed: json(row.before).status === 'proposed', listed: true }
  }
  if (row.id < agreed.id) return { proposed: true, listed: false }
  return { proposed: row.id === agreed.id, listed: true }
}

function templateTopics(db: Db, row: AuditLogRow, id: number, out: Set<Topic>): void {
  out.add(idTopic('template', id))
  const era = templateEra(db, row, id)
  if (era.proposed) out.add('templates:proposed')
  if (era.listed) out.add('templates')
  if (row.action === 'template.agreed' || row.action === 'template.cancelled') out.add('tasks')
}

function settlementTaker(db: Db, id: number): number | null {
  return (
    db
      .select({ takerId: settlements.takerId })
      .from(settlements)
      .where(eq(settlements.id, id))
      .get()?.takerId ?? null
  )
}

function adjustmentTaker(db: Db, id: number): number | null {
  return (
    db
      .select({ takerId: pointAdjustments.takerId })
      .from(pointAdjustments)
      .where(eq(pointAdjustments.id, id))
      .get()?.takerId ?? null
  )
}

/** The taker a `dispute.corrected` entry's correction changed (its `after.correction` link). */
function correctedTaker(db: Db, row: AuditLogRow): number | null {
  const link = json(row.after).correction as { kind?: unknown; id?: unknown } | undefined
  const id = userIdIn(link?.id)
  if (id === null) return null
  if (link?.kind === 'adjustment') return adjustmentTaker(db, id)
  if (link?.kind === 'settlement_correction') {
    const c = db
      .select({ settlementId: settlementCorrections.settlementId })
      .from(settlementCorrections)
      .where(eq(settlementCorrections.id, id))
      .get()
    return c ? settlementTaker(db, c.settlementId) : null
  }
  return null
}

function disputeTopics(db: Db, row: AuditLogRow, id: number, out: Set<Topic>): void {
  out.add('disputes')
  const d = db.select().from(disputes).where(eq(disputes.id, id)).get()
  if (d) {
    out.add(idTopic('disputes:by', d.openedBy))
    const loaded = loadTarget(db, { kind: d.itemKind, id: d.itemId })
    const perTaker = d.itemKind === 'settlement' || d.itemKind === 'adjustment'
    const taker = loaded?.about.takerId ?? null
    if (loaded) {
      out.add(taker === null ? 'disputes:about:none' : idTopic('disputes:about', taker))
      // The disputed item's own page shows the mark.
      const page = loaded.about.page
      if (page) out.add(idTopic(page.kind, page.id))
    }
    if (perTaker) takerFact(out, taker)
  }
  if (row.action === 'dispute.corrected') takerFact(out, correctedTaker(db, row))
}

function suggestionTopics(db: Db, id: number, out: Set<Topic>): void {
  out.add('suggestions')
  const s = db
    .select({ authorId: suggestions.authorId })
    .from(suggestions)
    .where(eq(suggestions.id, id))
    .get()
  if (s) out.add(idTopic('suggestions:by', s.authorId))
}

/** The topics one audit entry fires: deduplicated, sorted; `[]` for out of scope actions. */
export function topicsOf(db: Db, row: AuditLogRow): Topic[] {
  if (MAPPED[row.action] === 'none' || SILENT_ENTITIES.has(row.entityType)) return []
  const out = new Set<Topic>()
  const id = idOf(row.entityId)
  const prefix = row.action.slice(0, row.action.indexOf('.'))
  switch (prefix) {
    case 'task':
    case 'instance':
      if (id !== null) taskTopics(db, row, id, out)
      else out.add('tasks').add('week')
      break
    case 'template':
      if (id !== null) templateTopics(db, row, id, out)
      else out.add('templates:proposed')
      break
    case 'period':
      if (row.action === 'period.created' || row.action === 'period.ended') {
        out.add('week').add('proposals').add('tasks')
      } else out.add('proposals').add('week')
      break
    case 'defaults':
      out.add('proposals').add('week')
      break
    case 'settlement':
      takerFact(
        out,
        (id === null ? null : settlementTaker(db, id)) ?? userIdIn(json(row.after).takerId),
      )
      break
    case 'points':
      takerFact(
        out,
        (id === null ? null : adjustmentTaker(db, id)) ?? userIdIn(json(row.after).takerId),
      )
      break
    case 'dispute':
      if (id !== null) disputeTopics(db, row, id, out)
      else out.add('disputes')
      break
    case 'user':
      out.add('people')
      // Approvals count only active parties, live: a people change (the brother whose yes it
      // held deactivated) can move a proposed chore onto or off a boy's list with no chore entry.
      if (
        db
          .select({ id: templates.id })
          .from(templates)
          .where(eq(templates.status, 'proposed'))
          .limit(1)
          .get()
      ) {
        out.add('templates:proposed')
      }
      break
    case 'settings':
      out.add('settings').add('week')
      break
    case 'suggestion':
      if (id !== null) suggestionTopics(db, id, out)
      else out.add('suggestions')
      break
    default:
      throw new Error(`live: no topics for ${row.action}`)
  }
  return [...out].sort()
}
