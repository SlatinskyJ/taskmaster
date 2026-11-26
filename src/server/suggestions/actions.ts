import type { SuggestionTextError } from '~/domain'
import type { Result } from '~/domain/result'
import type { Db } from '~/server/db'
import { getFlags } from '~/server/features'
import { githubToken } from './github'
import type { FetchFn } from './github'
import { sendSuggestion } from './send'
import type { SendError, SentNotSaved } from './send'
import {
  closeSuggestionIn,
  createSuggestionIn,
  listAllSuggestions,
  listMySuggestions,
} from './store'
import type { AdminSuggestion, MySuggestion, SuggestionError } from './store'

// What each suggestion server function does with its parsed input, so it is tested without the
// framework (./functions passes `getDb()`, the signed-in user's id and `process.env`). The
// `suggestions` switch comes first: with it off nothing is read or written.

const OFF = { ok: false, error: 'feature_off' } as const
type Off = typeof OFF

export function createSuggestionAction(
  db: Db,
  userId: number,
  data: { title: string; description: string },
  now: Date,
): Result<{ id: number }, SuggestionTextError> | Off {
  if (!getFlags(db).suggestions) return OFF
  return createSuggestionIn(db, userId, data, now)
}

export function listMySuggestionsAction(
  db: Db,
  userId: number,
): MySuggestion[] | { error: 'feature_off' } {
  if (!getFlags(db).suggestions) return { error: 'feature_off' }
  return listMySuggestions(db, userId)
}

/** The admin's list; `canSend` says whether a token is set, never what it is. */
export function getAdminSuggestionsAction(
  db: Db,
  env: NodeJS.ProcessEnv,
): { items: AdminSuggestion[]; canSend: boolean } | { error: 'feature_off' } {
  if (!getFlags(db).suggestions) return { error: 'feature_off' }
  return { items: listAllSuggestions(db), canSend: githubToken(env) !== null }
}

export function closeSuggestionAction(
  db: Db,
  adminId: number,
  data: { id: number; move: 'done' | 'dismiss' },
  now: Date,
): Result<{ id: number }, SuggestionError> | Off {
  if (!getFlags(db).suggestions) return OFF
  return closeSuggestionIn(db, adminId, data.id, data.move, now)
}

export async function sendSuggestionAction(
  db: Db,
  adminId: number,
  data: { id: number; title: string; body: string },
  env: NodeJS.ProcessEnv,
  now: Date,
  fetchFn?: FetchFn,
): Promise<Result<{ url: string }, SendError> | SentNotSaved | Off> {
  if (!getFlags(db).suggestions) return OFF
  const draft = { title: data.title, body: data.body }
  return sendSuggestion(db, adminId, data.id, draft, githubToken(env), now, fetchFn)
}
