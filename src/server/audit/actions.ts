// Closed lists for the audit log (spec §5.10). This file must stay import-free: the DB schema
// (src/server/db/schema/audit.ts) imports it, and the audit module imports the schema.
//
// Audit action types. Extend this list as features land; never rename or remove a
// value that may already be stored (old rows keep it). Format: `<entity>.<verb>`.
export const AUDIT_ACTIONS = [
  // Accounts and sessions (§6)
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.logout',
  'auth.password_change_failed',
  'passkey.registered',
  'passkey.removed',
  'user.created',
  'user.updated',
  'settings.changed',
  // Launch switches turned on by the demo seed (#183)
  'feature.switched',
  // One-time tasks (§5.2)
  'task.created',
  'task.score_offered',
  'task.score_countered',
  'task.bid_placed',
  'task.bid_accepted',
  'task.bid_withdrawn',
  'task.bids_turned_down',
  'task.bidding_reopened',
  'task.bidding_closed',
  'task.score_approved',
  'task.score_change_proposed',
  'task.score_changed',
  'task.score_change_approved',
  'task.score_change_declined',
  'task.score_change_withdrawn',
  'task.score_change_discarded',
  'task.agreed',
  'task.reserved',
  'task.released',
  'task.completed',
  'task.approved',
  'task.rejected',
  'task.cancelled',
  // Recurring templates and instances (§5.1, §5.3)
  'template.created',
  'template.score_approved',
  'template.score_change_proposed',
  'template.bid_placed',
  'template.score_countered',
  'template.score_changed',
  'template.agreed',
  'template.updated',
  'template.cancelled',
  // Instances are rows of `tasks` (#38): their entries have entity type `task`. Only their
  // birth has its own action (`instance.created` on demand or scheduled, `instance.self_logged`)
  // and the scheduler's `instance.expired` (#39); every later step reuses the `task.*` action.
  // The other `instance.*` names are unused and stay listed (names are never removed).
  'instance.created',
  'instance.self_logged',
  'instance.reserved',
  'instance.released',
  'instance.completed',
  'instance.approved',
  'instance.rejected',
  'instance.expired',
  'instance.cancelled',
  // Periods and default settings (§5.8)
  'period.created',
  'period.ended',
  'period.proposal_created',
  'period.proposal_approved',
  'period.proposal_rejected',
  'period.proposal_withdrawn',
  'period.proposal_agreed',
  'period.proposal_lapsed',
  'defaults.proposal_created',
  'defaults.proposal_approved',
  'defaults.proposal_rejected',
  'defaults.proposal_withdrawn',
  'defaults.proposal_agreed',
  // Settlement and admin (§5.9)
  'settlement.created',
  'settlement.corrected',
  'points.adjusted',
  // Disputes (§5.11)
  'dispute.opened',
  'dispute.corrected',
  'dispute.dismissed',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** Who did it: a signed-in user, the scheduler (`system`), or nobody known (failed login). */
export const ACTOR_KINDS = ['user', 'system', 'anonymous'] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

/**
 * What an entry is about. A closed list so one entity is never logged under two spellings
 * (the log is append-only, so a misspelt row could never be fixed). Extend as features land.
 */
export const ENTITY_TYPES = [
  'user',
  'session',
  'passkey',
  'settings',
  'task',
  'template',
  /** Not used: instance rows are entity `task` (#38). Kept, since names are never removed. */
  'instance',
  'period',
  'period_proposal',
  'defaults_proposal',
  'settlement',
  'adjustment',
  'dispute',
  'app_meta',
  'feature',
] as const
export type EntityType = (typeof ENTITY_TYPES)[number]
