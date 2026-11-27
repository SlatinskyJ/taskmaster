import { eq } from 'drizzle-orm'
import { historyText } from '~/components/tasks/historyText'
import { cs } from '~/lib/strings'
import type { AuditAction, AuditLogRow } from '~/server/audit'
import { ForbiddenError } from '~/server/auth/guards'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import type { UserRole } from '~/server/db/schema'
import { taskDetailHandler } from '~/server/tasks/functions'
import type { HistoryEntry } from '~/server/tasks/functions'
import { templateDetailHandler } from '~/server/templates/functions'

// A live event's Czech sentence (#299, design "The event"): "<actor> · <phrase>[ · <title>]",
// built for one viewer. Task and chore steps share the wording of a task's Historie
// (`historyText`); the rest have their own phrase in `cs.live`. A title, and any score in the
// phrase, only when the viewer may load the entity, as that entity's own detail handler decides;
// otherwise "<actor> · změna". Never a value of the entry's `before` / `after` beyond that.

export interface Viewer {
  id: number
  role: UserRole
}

/** Titles by `${entityType}:${entityId}:${viewer.id}:${viewer.role}`; null: none for him. */
export type TitleCache = Map<string, string | null>

/**
 * How each action is phrased: like a task's Historie (`task`), like a chore's (`template`), with
 * its own `cs.live` phrase (`own`), or not at all (`none`, as in `MAPPED`: never on a stream).
 * Exhaustive, so a new action fails typecheck.
 */
export const PHRASED: Record<AuditAction, 'task' | 'template' | 'own' | 'none'> = {
  'auth.login_succeeded': 'none',
  'auth.login_failed': 'none',
  'auth.logout': 'none',
  'auth.password_change_failed': 'none',
  'passkey.registered': 'none',
  'passkey.removed': 'none',
  'user.created': 'own',
  'user.updated': 'own',
  'settings.changed': 'own',
  'feature.switched': 'none',
  'task.created': 'task',
  'task.score_offered': 'task',
  'task.score_countered': 'task',
  'task.bid_placed': 'task',
  'task.bid_accepted': 'task',
  'task.bid_withdrawn': 'task',
  'task.bids_turned_down': 'task',
  'task.bidding_reopened': 'task',
  'task.bidding_closed': 'task',
  'task.score_approved': 'task',
  'task.score_change_proposed': 'task',
  'task.score_changed': 'task',
  'task.score_change_approved': 'task',
  'task.score_change_declined': 'task',
  'task.score_change_withdrawn': 'task',
  'task.score_change_discarded': 'task',
  'task.agreed': 'task',
  'task.reserved': 'task',
  'task.released': 'task',
  'task.completed': 'task',
  'task.approved': 'task',
  'task.rejected': 'task',
  'task.cancelled': 'task',
  'task.description_changed': 'task',
  'task.description_change_proposed': 'task',
  'task.description_change_approved': 'task',
  'task.description_change_declined': 'task',
  'task.description_change_withdrawn': 'task',
  'task.description_change_discarded': 'task',
  'template.created': 'template',
  'template.score_approved': 'template',
  'template.score_change_proposed': 'template',
  'template.bid_placed': 'template',
  'template.score_countered': 'template',
  'template.bid_withdrawn': 'template',
  'template.bids_turned_down': 'template',
  'template.score_changed': 'template',
  'template.agreed': 'template',
  'template.updated': 'template',
  'template.cancelled': 'template',
  'template.description_changed': 'template',
  'template.description_change_proposed': 'template',
  'template.description_change_approved': 'template',
  'template.description_change_declined': 'template',
  'template.description_change_withdrawn': 'template',
  'instance.created': 'task',
  'instance.self_logged': 'task',
  'instance.reserved': 'task',
  'instance.released': 'task',
  'instance.completed': 'task',
  'instance.approved': 'task',
  'instance.rejected': 'task',
  'instance.expired': 'task',
  'instance.cancelled': 'task',
  'instance.week_rules_dropped': 'task',
  'period.created': 'own',
  'period.ended': 'own',
  'period.proposal_created': 'own',
  'period.proposal_approved': 'own',
  'period.proposal_rejected': 'own',
  'period.proposal_withdrawn': 'own',
  'period.proposal_agreed': 'own',
  'period.proposal_lapsed': 'own',
  'defaults.proposal_created': 'own',
  'defaults.proposal_approved': 'own',
  'defaults.proposal_rejected': 'own',
  'defaults.proposal_withdrawn': 'own',
  'defaults.proposal_agreed': 'own',
  'settlement.created': 'own',
  'settlement.corrected': 'own',
  'points.adjusted': 'own',
  'dispute.opened': 'own',
  'dispute.corrected': 'own',
  'dispute.dismissed': 'own',
  'suggestion.created': 'own',
  'suggestion.sent': 'own',
  'suggestion.done': 'own',
  'suggestion.dismissed': 'own',
}

type HistoryAction = HistoryEntry['action']

/** The task step an entry reads as in Historie; null: none (a fallback). */
function taskAction(action: AuditAction): HistoryAction | null {
  switch (action) {
    case 'instance.reserved':
    case 'instance.released':
    case 'instance.completed':
    case 'instance.approved':
    case 'instance.rejected':
    case 'instance.cancelled':
      return `task.${action.slice('instance.'.length)}` as HistoryAction
    case 'instance.week_rules_dropped':
      return null
    default:
      return action.startsWith('task.') ||
        action === 'instance.created' ||
        action === 'instance.self_logged' ||
        action === 'instance.expired'
        ? (action as HistoryAction)
        : null
  }
}

/** A chore step as the task step with the same words (`template.updated` has its own). */
const TEMPLATE_AS: Partial<Record<AuditAction, HistoryAction>> = {
  'template.created': 'task.created',
  'template.score_approved': 'task.score_approved',
  'template.score_change_proposed': 'task.score_change_proposed',
  'template.bid_placed': 'task.bid_placed',
  'template.score_countered': 'task.score_countered',
  'template.bid_withdrawn': 'task.bid_withdrawn',
  'template.bids_turned_down': 'task.bids_turned_down',
  'template.score_changed': 'task.score_changed',
  'template.agreed': 'task.agreed',
  'template.cancelled': 'task.cancelled',
  'template.description_changed': 'task.description_changed',
  'template.description_change_proposed': 'task.description_change_proposed',
  'template.description_change_approved': 'task.description_change_approved',
  'template.description_change_declined': 'task.description_change_declined',
  'template.description_change_withdrawn': 'task.description_change_withdrawn',
}

/** Steps whose phrase names a score: without one in the entry they fall back. */
const SCORED = new Set<HistoryAction>([
  'task.created',
  'task.score_offered',
  'task.score_countered',
  'task.bid_placed',
  'task.bid_accepted',
  'task.score_approved',
  'task.agreed',
  'task.score_change_proposed',
  'task.score_change_approved',
  'task.score_change_declined',
  'task.score_changed',
  'task.score_change_discarded',
  'instance.created',
  'instance.self_logged',
])

const OWN: Partial<Record<AuditAction, string>> = {
  'user.created': cs.live.userCreated,
  'user.updated': cs.live.userUpdated,
  'settings.changed': cs.live.settingsChanged,
  'period.created': cs.live.periodCreated,
  'period.ended': cs.live.periodEnded,
  'period.proposal_created': cs.live.period.created,
  'period.proposal_approved': cs.live.period.approved,
  'period.proposal_rejected': cs.live.period.rejected,
  'period.proposal_withdrawn': cs.live.period.withdrawn,
  'period.proposal_agreed': cs.live.period.agreed,
  'period.proposal_lapsed': cs.live.period.lapsed,
  'defaults.proposal_created': cs.live.defaults.created,
  'defaults.proposal_approved': cs.live.defaults.approved,
  'defaults.proposal_rejected': cs.live.defaults.rejected,
  'defaults.proposal_withdrawn': cs.live.defaults.withdrawn,
  'defaults.proposal_agreed': cs.live.defaults.agreed,
  'settlement.created': cs.live.settled,
  'settlement.corrected': cs.live.settlementCorrected,
  'points.adjusted': cs.live.pointsAdjusted,
  'dispute.opened': cs.live.disputeOpened,
  'dispute.corrected': cs.live.disputeCorrected,
  'dispute.dismissed': cs.live.disputeDismissed,
  'suggestion.created': cs.live.suggestionCreated,
  'suggestion.sent': cs.live.suggestionSent,
  'suggestion.done': cs.live.suggestionDone,
  'suggestion.dismissed': cs.live.suggestionDismissed,
}

function afterField(after: string | null, key: string): unknown {
  if (after === null) return undefined
  try {
    const parsed: unknown = JSON.parse(after)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)[key]
      : undefined
  } catch {
    return undefined
  }
}

const safeInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null

function displayName(db: Db, id: number): string | null {
  return (
    db.select({ name: users.displayName }).from(users).where(eq(users.id, id)).get()?.name ?? null
  )
}

function actorWord(db: Db, row: AuditLogRow, viewer: Viewer): string {
  if (row.actorKind !== 'user' || row.actorUserId === null) return cs.live.system
  if (row.actorUserId === viewer.id) return cs.live.you
  return displayName(db, row.actorUserId) ?? cs.live.system
}

/** The entity's title as this viewer's detail screen would load it; null when it would not. */
function titleFor(
  db: Db,
  kind: 'task' | 'template',
  entityId: string,
  viewer: Viewer,
  cache: TitleCache,
): string | null {
  const key = `${kind}:${entityId}:${String(viewer.id)}:${viewer.role}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const id = Number(entityId)
  let title: string | null = null
  if (Number.isSafeInteger(id) && id > 0) {
    try {
      title =
        kind === 'task'
          ? (taskDetailHandler(db, viewer, { taskId: id })?.task.title ?? null)
          : (templateDetailHandler(db, viewer, { templateId: id })?.template.title ?? null)
    } catch (err) {
      if (!(err instanceof ForbiddenError)) throw err
    }
  }
  cache.set(key, title)
  return title
}

/** The Historie phrase of `row` read as `action`; null when it names a score the entry lacks. */
function stepPhrase(
  db: Db,
  row: AuditLogRow,
  action: HistoryAction,
  viewer: Viewer,
): string | null {
  const score = safeInt(afterField(row.after, 'score'))
  if (SCORED.has(action) && score === null) return null
  const reserved = action === 'task.agreed' ? safeInt(afterField(row.after, 'reservedBy')) : null
  const reservedName = reserved === null ? null : displayName(db, reserved)
  const entry: HistoryEntry = {
    id: row.id,
    at: row.at,
    action,
    by:
      row.actorUserId === null
        ? null
        : { id: row.actorUserId, name: displayName(db, row.actorUserId) ?? '' },
    score,
    reservedBy:
      reserved === null || reservedName === null ? null : { id: reserved, name: reservedName },
    reason: row.reason,
  }
  return historyText(entry, viewer.id)
}

/** One audit entry's sentence for one viewer. A cache shared over a flush saves detail reads. */
export function liveText(
  db: Db,
  row: AuditLogRow,
  viewer: Viewer,
  cache: TitleCache = new Map(),
): string {
  const { sep } = cs.live
  const actor = actorWord(db, row, viewer)
  const fallback = actor + sep + cs.history.other
  const kind = PHRASED[row.action]
  if (kind === 'none') return fallback
  if (kind === 'own') {
    // A boy gets no hint what changed on someone's account (Security judge, PR 2).
    if (row.action.startsWith('user.') && viewer.role === 'taker') return fallback
    const phrase = OWN[row.action]
    return phrase === undefined ? fallback : actor + sep + phrase
  }
  if (kind === 'task') {
    const action = taskAction(row.action)
    if (action === null) return fallback
    const title = titleFor(db, 'task', row.entityId, viewer, cache)
    if (title === null) return fallback
    const phrase = stepPhrase(db, row, action, viewer)
    return phrase === null ? fallback : actor + sep + phrase + sep + title
  }
  const title = titleFor(db, 'template', row.entityId, viewer, cache)
  if (title === null) return fallback
  if (row.action === 'template.updated') return actor + sep + cs.live.templateUpdated + sep + title
  const as = TEMPLATE_AS[row.action]
  const phrase = as === undefined ? null : stepPhrase(db, row, as, viewer)
  return phrase === null ? fallback : actor + sep + phrase + sep + title
}
