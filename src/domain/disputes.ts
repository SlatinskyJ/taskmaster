import type { OneTimeAgreement, TemplateAgreement } from './agreement'
import type { Person, PersonId } from './parties'
import { findPerson, isActiveAdmin, isParty } from './parties'
import type { Result } from './result'
import { fail, ok } from './result'

// Disputes on locked items (spec §5.11, Jakub 2026-11-16).
//
// Any taker or giver flags a locked item as disputed, with a reason. The item keeps its values
// and state; [call] a dispute blocks nothing (the meeting and settlement go ahead). Only the
// admin resolves it:
//   - correct: a settlement correction or a manual adjustment (`settlement.ts`), written in the
//     same transaction; the original record is preserved;
//   - dismiss: nothing changes, with a note.
// [call] An item has at most one open dispute at a time. A closed dispute does not stop a new
// one on the same item.
//
// Caller duty: opening, correcting and dismissing are audit actions (spec §5.10). A correction
// writes its settlement correction / adjustment and closes the dispute in one transaction.

export type DisputeError =
  | 'not_a_party'
  | 'not_admin'
  | 'not_locked'
  | 'reason_required'
  | 'note_required'
  | 'dispute_open'
  | 'not_open'
  | 'wrong_correction'

export type DisputeKind =
  'task_score' | 'template_score' | 'completion' | 'settlement' | 'adjustment'

/** Which record a dispute is about. `id` is that record's id. */
export interface DisputeRef {
  kind: DisputeKind
  id: number
}

/** A completion record's outcome; only a confirmed or rejected one is locked. */
export type CompletionOutcome = 'pending' | 'confirmed' | 'rejected'

/** The disputed record with the state that decides whether it is locked. */
export type DisputeTarget =
  | (DisputeRef & { kind: 'task_score'; agreement: OneTimeAgreement['status'] })
  | (DisputeRef & { kind: 'template_score'; agreement: TemplateAgreement['status'] })
  | (DisputeRef & { kind: 'completion'; outcome: CompletionOutcome })
  | (DisputeRef & { kind: 'settlement' })
  | (DisputeRef & { kind: 'adjustment' })

/**
 * Locked items (spec §5.11): an agreed score (task or template), a confirmed or rejected
 * completion, a settlement record, a manual adjustment.
 */
export function isLocked(target: DisputeTarget): boolean {
  switch (target.kind) {
    case 'task_score':
    case 'template_score':
      return target.agreement !== 'proposed'
    case 'completion':
      return target.outcome !== 'pending'
    case 'settlement':
    case 'adjustment':
      return true
  }
}

/** How the admin corrected: a settlement correction (settlements only) or an adjustment. */
export type CorrectionKind = 'settlement_correction' | 'adjustment'

export type Dispute = {
  item: DisputeRef
  openedBy: PersonId
  reason: string
} & (
  | { status: 'open' }
  | { status: 'corrected'; resolvedBy: PersonId; via: CorrectionKind; note: string }
  | { status: 'dismissed'; resolvedBy: PersonId; note: string }
)

export type DisputeStatus = Dispute['status']

const sameItem = (a: DisputeRef, b: DisputeRef) => a.kind === b.kind && a.id === b.id

function cleanText(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}

/** Whether the item has an open dispute (to show the "disputed" mark). */
export function isDisputed(item: DisputeRef, disputes: readonly Dispute[]): boolean {
  return disputes.some((d) => d.status === 'open' && sameItem(d.item, item))
}

/**
 * A taker or giver disputes a locked item, with a reason. `existing` = disputes on any items
 * ([call] refused while one on the same item is open).
 */
export function openDispute(
  people: readonly Person[],
  openerId: PersonId,
  target: DisputeTarget,
  reason: string,
  existing: readonly Dispute[],
): Result<Dispute, DisputeError> {
  const opener = findPerson(people, openerId)
  if (!opener || !isParty(opener)) return fail('not_a_party')
  if (!isLocked(target)) return fail('not_locked')
  const why = cleanText(reason)
  if (!why) return fail('reason_required')
  const item: DisputeRef = { kind: target.kind, id: target.id }
  if (isDisputed(item, existing)) return fail('dispute_open')
  return ok({ item, openedBy: openerId, reason: why, status: 'open' })
}

function checkAdminOnOpen(
  dispute: Dispute,
  people: readonly Person[],
  adminId: PersonId,
): DisputeError | null {
  const admin = findPerson(people, adminId)
  if (!admin || !isActiveAdmin(admin)) return 'not_admin'
  if (dispute.status !== 'open') return 'not_open'
  return null
}

/**
 * The admin closes the dispute as corrected. The correction itself (`correctSettlement` or
 * `adjustPoints`) is written in the same transaction. A settlement correction only fits a
 * disputed settlement; an adjustment fits any item.
 */
export function correctDispute(
  dispute: Dispute,
  people: readonly Person[],
  adminId: PersonId,
  via: CorrectionKind,
  note: string,
): Result<Dispute, DisputeError> {
  const refused = checkAdminOnOpen(dispute, people, adminId)
  if (refused) return fail(refused)
  if (via === 'settlement_correction' && dispute.item.kind !== 'settlement') {
    return fail('wrong_correction')
  }
  const text = cleanText(note)
  if (!text) return fail('note_required')
  return ok({
    item: dispute.item,
    openedBy: dispute.openedBy,
    reason: dispute.reason,
    status: 'corrected',
    resolvedBy: adminId,
    via,
    note: text,
  })
}

/** The admin dismisses the dispute with a note; the item stays as it is. */
export function dismissDispute(
  dispute: Dispute,
  people: readonly Person[],
  adminId: PersonId,
  note: string,
): Result<Dispute, DisputeError> {
  const refused = checkAdminOnOpen(dispute, people, adminId)
  if (refused) return fail(refused)
  const text = cleanText(note)
  if (!text) return fail('note_required')
  return ok({
    item: dispute.item,
    openedBy: dispute.openedBy,
    reason: dispute.reason,
    status: 'dismissed',
    resolvedBy: adminId,
    note: text,
  })
}
