import { createServerFn } from '@tanstack/react-start'
import { requireRole, requireUser } from '~/server/auth/guards'
import { getDb } from '~/server/db'
import {
  closeSuggestionAction,
  createSuggestionAction,
  getAdminSuggestionsAction,
  listMySuggestionsAction,
  sendSuggestionAction,
} from './actions'
import { parseClose, parseNewSuggestion, parseSend } from './parse'

// Server functions for suggestions (#247), behind the `suggestions` switch. Anyone signed in
// suggests and lists their own; the admin's functions are guarded here and checked again in the
// store. The GitHub token is read from the environment here and nowhere else.

export type { AdminSuggestion, MySuggestion } from './store'

/** Profil: anyone signed in suggests an improvement. */
export const createSuggestionFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(parseNewSuggestion)
  .handler(({ data, context }) =>
    createSuggestionAction(getDb(), context.user.id, data, new Date()),
  )

/** Profil: the caller's own suggestions and their state. */
export const listMySuggestionsFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(({ context }) => listMySuggestionsAction(getDb(), context.user.id))

/** Správa: everyone's suggestions, and whether the send is available. */
export const getAdminSuggestionsFn = createServerFn({ method: 'GET' })
  .middleware([requireRole('admin')])
  .handler(() => getAdminSuggestionsAction(getDb(), process.env))

/** Správa: Hotovo or Zamítnout. */
export const closeSuggestionFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseClose)
  .handler(({ data, context }) => closeSuggestionAction(getDb(), context.user.id, data, new Date()))

/** Správa: send the edited preview to GitHub as an issue. */
export const sendSuggestionFn = createServerFn({ method: 'POST' })
  .middleware([requireRole('admin')])
  .validator(parseSend)
  .handler(({ data, context }) =>
    sendSuggestionAction(getDb(), context.user.id, data, process.env, new Date()),
  )
