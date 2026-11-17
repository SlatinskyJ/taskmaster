import type { Person, PersonId } from './parties'
import { isActiveGiver, isActiveTaker } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Lifecycle of a one-time task or a recurring instance (spec §5.3–§5.6).
//
//   negotiating ──(agreed)──► open ──(reserve)──► reserved
//                              ▲  ◄──(release)───┘   │
//                              ▼                     ▼
//                        done_unconfirmed ◄──────────┘
//                              │
//          (giver approves) ───┴─── (giver rejects → reserved by the same taker, else open)
//                ▼
//            confirmed
//
//   open / reserved ──(deadline + grace passed)──► expired
//   negotiating / open / reserved ──(giver cancels)──► cancelled         [call]
//   self-logged: born done_unconfirmed; rejected → rejected              [call]
//
// The score itself lives in the agreement (`agreement.ts`); this module only tracks states and
// who may move an item between them. Nothing is ever deleted: cancelled, expired and rejected
// are end states (spec §5.10).

/** [call] Approval is required unless the giver turns it off (spec §5.5). */
export const DEFAULT_APPROVAL_REQUIRED = true

/** Where an item came from (spec §5.2, §5.3). */
export type ItemOrigin = 'one_time' | 'scheduled' | 'on_demand' | 'self_logged'

/**
 * Completion is allowed before `graceEndsAt`; from that instant on the item expires
 * (spec §5.3). Half-open window: an action exactly at `graceEndsAt` is too late.
 */
export interface Deadline {
  dueAt: Date
  graceEndsAt: Date
}

/** A taker's claim. `bid` = reserved by winning a bid (spec §5.2 path 2), `tap` = reserved by hand. */
export interface Reservation {
  takerId: PersonId
  via: 'bid' | 'tap'
}

export interface Completion {
  completedBy: PersonId
  /** Decides the period the points belong to (spec §5.5). */
  completedAt: Date
  /** The taker who gets the points; `null` when a giver completed (givers earn none). */
  earner: PersonId | null
  /** The reservation held when it was completed, restored if the completion is rejected. */
  reservation: Reservation | null
}

export type ItemState =
  | { status: 'negotiating' }
  | { status: 'open' }
  | { status: 'reserved'; reservation: Reservation }
  | { status: 'done_unconfirmed'; completion: Completion }
  | { status: 'confirmed'; completion: Completion }
  | { status: 'expired' }
  | { status: 'cancelled' }
  /** End state for a rejected self-logged chore [call]. */
  | { status: 'rejected'; completion: Completion }

export type ItemStatus = ItemState['status']

export type Item = {
  origin: ItemOrigin
  approvalRequired: boolean
  /** Only instances of deadline templates have one (spec §5.3). */
  deadline: Deadline | null
} & ItemState

/** Who acts: a person, or the scheduler (scheduled instances, expiry). */
export type Actor = { kind: 'person'; person: Person } | { kind: 'system' }

export const SYSTEM: Actor = { kind: 'system' }

export const byPerson = (person: Person): Actor => ({ kind: 'person', person })

export type LifecycleError =
  | 'not_a_giver'
  | 'not_a_taker'
  | 'not_allowed'
  | 'invalid_deadline'
  | 'wrong_state'
  | 'reserved_by_other'
  | 'past_grace'
  | 'no_deadline'
  | 'grace_not_over'

const giver = (actor: Actor): boolean => actor.kind === 'person' && isActiveGiver(actor.person)
const taker = (actor: Actor): boolean => actor.kind === 'person' && isActiveTaker(actor.person)

function pastGrace(deadline: Deadline | null, at: Date): boolean {
  return deadline !== null && at.getTime() >= deadline.graceEndsAt.getTime()
}

// ── Creation ─────────────────────────────────────────────────────────────────────────────

/**
 * A giver creates a one-time task. It starts in negotiation; the agreement module decides
 * when it is agreed (`markAgreed`). One-time tasks have no deadline.
 */
export function createOneTimeItem(
  actor: Actor,
  approvalRequired: boolean = DEFAULT_APPROVAL_REQUIRED,
): Result<Item, LifecycleError> {
  if (!giver(actor)) return fail('not_a_giver')
  return ok({ origin: 'one_time', approvalRequired, deadline: null, status: 'negotiating' })
}

/**
 * A recurring instance is born open at the template score (spec §5.6). `scheduled` is created
 * by the scheduler, `on_demand` by a giver. The caller checks the template is agreed
 * (`canCreateInstances`) and copies its approval flag and deadline.
 */
export function createInstance(
  actor: Actor,
  origin: 'scheduled' | 'on_demand',
  approvalRequired: boolean,
  deadline: Deadline | null,
): Result<Item, LifecycleError> {
  if (origin === 'scheduled' && actor.kind !== 'system') return fail('not_allowed')
  if (origin === 'on_demand' && !giver(actor)) return fail('not_a_giver')
  if (deadline && deadline.graceEndsAt.getTime() < deadline.dueAt.getTime()) {
    return fail('invalid_deadline')
  }
  return ok({ origin, approvalRequired, deadline, status: 'open' })
}

/**
 * A taker logs a chore done unprompted (spec §5.3): born done, unconfirmed, and it always needs
 * a giver's approval, whatever the template's flag says.
 */
export function selfLog(actor: Actor, at: Date): Result<Item, LifecycleError> {
  if (actor.kind !== 'person' || !isActiveTaker(actor.person)) return fail('not_a_taker')
  const takerId = actor.person.id
  return ok({
    origin: 'self_logged',
    approvalRequired: true,
    deadline: null,
    status: 'done_unconfirmed',
    completion: { completedBy: takerId, completedAt: at, earner: takerId, reservation: null },
  })
}

// ── Agreement ────────────────────────────────────────────────────────────────────────────

/**
 * The score is agreed (spec §5.2): plain agreement opens the task; a won bid reserves it to
 * that taker. Called by the agreement code, which has already checked who agreed.
 */
export function markAgreed(item: Item, bidWinner: PersonId | null): Result<Item, LifecycleError> {
  if (item.status !== 'negotiating') return fail('wrong_state')
  const base = withoutState(item)
  if (bidWinner === null) return ok({ ...base, status: 'open' })
  return ok({ ...base, status: 'reserved', reservation: { takerId: bidWinner, via: 'bid' } })
}

// ── Reservation (spec §5.4) ──────────────────────────────────────────────────────────────

/** A taker reserves an open item ("I'll do this"). Optional. */
export function reserve(item: Item, actor: Actor, at: Date): Result<Item, LifecycleError> {
  if (actor.kind !== 'person' || !isActiveTaker(actor.person)) return fail('not_a_taker')
  if (item.status !== 'open') return fail('wrong_state')
  if (pastGrace(item.deadline, at)) return fail('past_grace')
  return ok({
    ...withoutState(item),
    status: 'reserved',
    reservation: { takerId: actor.person.id, via: 'tap' },
  })
}

/**
 * [call] A taker releases their own reservation; a giver releases anyone's. A one-time task
 * reserved by winning a bid goes back to negotiation [call]: the caller must restart the
 * agreement with the agreed score as the current offer, since only one taker agreed to it.
 */
export function release(item: Item, actor: Actor): Result<Item, LifecycleError> {
  if (item.status !== 'reserved') return fail('wrong_state')
  const own =
    actor.kind === 'person' && taker(actor) && actor.person.id === item.reservation.takerId
  if (!own && !giver(actor)) return fail('not_allowed')
  if (item.origin === 'one_time' && item.reservation.via === 'bid') {
    return ok({ ...withoutState(item), status: 'negotiating' })
  }
  return ok({ ...withoutState(item), status: 'open' })
}

// ── Completion and approval (spec §5.5) ──────────────────────────────────────────────────

/**
 * Someone marks the item done at `at` (stored as `completedAt`).
 * - A taker: anyone may do an open item; a reserved one only by its taker. Approval flag on →
 *   done, unconfirmed; off → confirmed.
 * - A giver: closes it with no points and no approval step [call], reserved or not.
 * Too late once the grace window is over.
 */
export function complete(item: Item, actor: Actor, at: Date): Result<Item, LifecycleError> {
  if (actor.kind !== 'person') return fail('not_allowed')
  const isGiver = isActiveGiver(actor.person)
  if (!isGiver && !isActiveTaker(actor.person)) return fail('not_allowed')
  if (item.status !== 'open' && item.status !== 'reserved') return fail('wrong_state')
  if (pastGrace(item.deadline, at)) return fail('past_grace')

  const reservation = item.status === 'reserved' ? item.reservation : null
  const actorId = actor.person.id
  if (isGiver) {
    const completion = { completedBy: actorId, completedAt: at, earner: null, reservation }
    return ok({ ...withoutState(item), status: 'confirmed', completion })
  }
  if (reservation && reservation.takerId !== actorId) return fail('reserved_by_other')
  const completion = { completedBy: actorId, completedAt: at, earner: actorId, reservation }
  const status = item.approvalRequired ? 'done_unconfirmed' : 'confirmed'
  return ok({ ...withoutState(item), status, completion })
}

/** A giver approves a pending completion: points become confirmed. */
export function approve(item: Item, actor: Actor): Result<Item, LifecycleError> {
  if (!giver(actor)) return fail('not_a_giver')
  if (item.status !== 'done_unconfirmed') return fail('wrong_state')
  return ok({ ...withoutState(item), status: 'confirmed', completion: item.completion })
}

/**
 * A giver rejects a pending completion. It goes back to where it came from: reserved by the same
 * taker if it was reserved, otherwise open. [call] A rejected self-logged chore is closed as
 * rejected, since it was never an open instance. The reason goes to the audit entry.
 */
export function reject(item: Item, actor: Actor): Result<Item, LifecycleError> {
  if (!giver(actor)) return fail('not_a_giver')
  if (item.status !== 'done_unconfirmed') return fail('wrong_state')
  const base = withoutState(item)
  if (item.origin === 'self_logged') {
    return ok({ ...base, status: 'rejected', completion: item.completion })
  }
  const { reservation } = item.completion
  if (reservation) return ok({ ...base, status: 'reserved', reservation })
  return ok({ ...base, status: 'open' })
}

// ── Expiry and cancellation ──────────────────────────────────────────────────────────────

/** The scheduler expires an open or reserved deadline item once its grace window is over. */
export function expire(item: Item, actor: Actor, now: Date): Result<Item, LifecycleError> {
  if (actor.kind !== 'system') return fail('not_allowed')
  if (item.status !== 'open' && item.status !== 'reserved') return fail('wrong_state')
  if (!item.deadline) return fail('no_deadline')
  if (!pastGrace(item.deadline, now)) return fail('grace_not_over')
  return ok({ ...withoutState(item), status: 'expired' })
}

/** [call] A giver cancels any item not yet completed. */
export function cancel(item: Item, actor: Actor): Result<Item, LifecycleError> {
  if (!giver(actor)) return fail('not_a_giver')
  if (item.status !== 'negotiating' && item.status !== 'open' && item.status !== 'reserved') {
    return fail('wrong_state')
  }
  return ok({ ...withoutState(item), status: 'cancelled' })
}

// ── Points ───────────────────────────────────────────────────────────────────────────────

/** The taker whose confirmed points this item adds to, or null (spec §5.5, §5.7). */
export function confirmedEarner(item: Item): PersonId | null {
  return item.status === 'confirmed' ? item.completion.earner : null
}

/** The taker whose pending points ("čeká") this item adds to, or null (spec §5.7). */
export function pendingEarner(item: Item): PersonId | null {
  return item.status === 'done_unconfirmed' ? item.completion.earner : null
}

function withoutState(item: Item): Pick<Item, 'origin' | 'approvalRequired' | 'deadline'> {
  return { origin: item.origin, approvalRequired: item.approvalRequired, deadline: item.deadline }
}
