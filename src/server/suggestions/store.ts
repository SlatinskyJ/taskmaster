import { and, desc, eq } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { Person, SuggestionStatus, SuggestionTextError } from '~/domain'
import { findPerson, isActiveAdmin, nextStatus, normaliseSuggestion } from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import type { Tx } from '~/server/audit'
import { writeAudit } from '~/server/audit'
import type { Db } from '~/server/db'
import { suggestions, users } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import { isSending } from './sending'

// Suggestions (spec §5.13, #247): anyone signed in creates one; only the admin closes it (done or
// dismissed) or sends it (./send). Every write and its audit entry share one transaction.

export type SuggestionError =
  SuggestionTextError | 'not_found' | 'not_admin' | 'not_new' | 'closed' | 'busy'

/** A suggestion as its author sees it: never the author, never the sent text. */
export interface MySuggestion {
  id: number
  title: string
  description: string | null
  status: SuggestionStatus
  issueUrl: string | null
  createdAt: string
}

/** A suggestion in the admin's list: who wrote it, too. */
export interface AdminSuggestion extends MySuggestion {
  author: { id: number; displayName: string }
}

const MINE = {
  id: suggestions.id,
  title: suggestions.title,
  description: suggestions.description,
  status: suggestions.status,
  issueUrl: suggestions.issueUrl,
  createdAt: suggestions.createdAt,
}

const NEWEST_FIRST = [desc(suggestions.createdAt), desc(suggestions.id)] as const

/** The second check after the server function's guard (as in ../users/manage). */
export function actsAsAdmin(people: readonly Person[], id: number): boolean {
  const person = findPerson(people, id)
  return person !== undefined && isActiveAdmin(person)
}

export function createSuggestionIn(
  db: Db | Tx,
  userId: number,
  raw: { title: string; description: string },
  now: Date,
): Result<{ id: number }, SuggestionTextError> {
  const text = normaliseSuggestion(raw)
  if (!text.ok) return text
  return db.transaction((tx) => {
    const { id } = tx
      .insert(suggestions)
      .values({ authorId: userId, ...text.value, createdAt: toIsoUtc(now), status: 'new' })
      .returning({ id: suggestions.id })
      .get()
    writeAudit(tx, {
      actor: { kind: 'user', userId },
      action: 'suggestion.created',
      entityType: 'suggestion',
      entityId: id,
      after: text.value,
      at: now,
    })
    return ok({ id })
  })
}

/** The caller's own suggestions, newest first. */
export function listMySuggestions(db: Db | Tx, userId: number): MySuggestion[] {
  return db
    .select(MINE)
    .from(suggestions)
    .where(eq(suggestions.authorId, userId))
    .orderBy(...NEWEST_FIRST)
    .all()
}

/** Everyone's suggestions with their author, newest first (the admin's list). */
export function listAllSuggestions(db: Db | Tx): AdminSuggestion[] {
  return db
    .select({ ...MINE, authorId: users.id, authorName: users.displayName })
    .from(suggestions)
    .innerJoin(users, eq(users.id, suggestions.authorId))
    .orderBy(...NEWEST_FIRST)
    .all()
    .map(({ authorId, authorName, ...s }) => ({
      ...s,
      author: { id: authorId, displayName: authorName },
    }))
}

/** Why a move that changed no row was refused, from the row as it is now. */
export function refusalNow(
  tx: Tx,
  id: number,
  move: 'send' | 'done' | 'dismiss',
): { ok: false; error: 'not_new' | 'closed' } {
  const now = tx
    .select({ status: suggestions.status })
    .from(suggestions)
    .where(eq(suggestions.id, id))
    .get()
  const next = now ? nextStatus(now.status, move) : fail('closed' as const)
  return next.ok ? fail('closed') : next
}

/** The admin marks a suggestion done, or dismisses a new one. */
export function closeSuggestionIn(
  db: Db | Tx,
  adminId: number,
  id: number,
  move: 'done' | 'dismiss',
  now: Date,
): Result<{ id: number }, SuggestionError> {
  if (isSending(id)) return fail('busy')
  return db.transaction((tx) => {
    if (!actsAsAdmin(listPeople(tx), adminId)) return fail('not_admin')
    const current = tx
      .select({ status: suggestions.status })
      .from(suggestions)
      .where(eq(suggestions.id, id))
      .get()
    if (!current) return fail('not_found')
    const next = nextStatus(current.status, move)
    if (!next.ok) return next
    const at = toIsoUtc(now)
    const changed = tx
      .update(suggestions)
      .set({ status: next.value, closedBy: adminId, closedAt: at })
      .where(and(eq(suggestions.id, id), eq(suggestions.status, current.status)))
      .run()
    // Another writer moved it between the read and the update: say why from its state now.
    if (changed.changes === 0) return refusalNow(tx, id, move)
    writeAudit(tx, {
      actor: { kind: 'user', userId: adminId },
      action: move === 'done' ? 'suggestion.done' : 'suggestion.dismissed',
      entityType: 'suggestion',
      entityId: id,
      before: { status: current.status },
      after: { status: next.value },
      at: now,
    })
    return ok({ id })
  })
}
