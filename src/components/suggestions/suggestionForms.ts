import type { AdminOutcome } from '~/components/disputes/disputeCalls'
import { cs } from '~/lib/strings'
import type {
  AdminSuggestion,
  closeSuggestionFn,
  createSuggestionFn,
  sendSuggestionFn,
} from '~/server/suggestions/functions'

// The suggestion sheets' checks and the one place the suggestion screens (#247) reach the
// server. Each error map is a Record over the server's codes, so a new code fails the typecheck
// until it has Czech text. The server's rules stay the rule; the check here only spares a request.

type CreateResult = Awaited<ReturnType<typeof createSuggestionFn>>
type CloseResult = Awaited<ReturnType<typeof closeSuggestionFn>>
type SendResult = Awaited<ReturnType<typeof sendSuggestionFn>>
type ErrorOf<R> = R extends { ok: false; error: infer E } ? E : never

export type CreateCall = (args: {
  data: { title: string; description: string }
}) => Promise<CreateResult>
export type CloseCall = (args: {
  data: { id: number; move: 'done' | 'dismiss' }
}) => Promise<CloseResult>
export type SendCall = (args: {
  data: { id: number; title: string; body: string }
}) => Promise<SendResult>

const e = cs.suggestions.errors

const createText: Record<ErrorOf<CreateResult>, string> = {
  title_empty: e.title_empty,
  title_too_long: e.title_too_long,
  description_too_long: e.description_too_long,
  feature_off: e.feature_off,
}

const closeText: Record<ErrorOf<CloseResult>, string> = {
  ...createText,
  not_found: e.not_found,
  not_admin: e.not_admin,
  not_new: e.not_new,
  closed: e.closed,
  busy: e.busy,
}

const sendText: Record<Exclude<ErrorOf<SendResult>, 'sent_not_saved'>, string> = {
  ...closeText,
  body_too_long: e.body_too_long,
  no_token: e.no_token,
  github_failed: e.github_failed,
}

/** Every code a Správa call can refuse with; typed so a renamed code fails the typecheck. */
type AdminError = ErrorOf<CloseResult> | ErrorOf<SendResult>

/** The row no longer matches the server (gone, closed, already sent): close and reload. */
const STALE: readonly AdminError[] = ['not_found', 'closed', 'not_new']

/** The sheet's own check before sending: a title of only spaces is no title. */
export function checkSuggestion(v: { title: string }): string | null {
  return v.title.trim() === '' ? e.title_empty : null
}

/** Sends a new suggestion; null when it went through, else the Czech message to show. */
export async function sendNewSuggestion(
  call: CreateCall,
  input: { title: string; description: string },
): Promise<string | null> {
  try {
    const r = await call({ data: input })
    return r.ok ? null : createText[r.error]
  } catch {
    return e.generic
  }
}

function refused<E extends AdminError>(error: E, text: Record<E, string>): AdminOutcome {
  return STALE.includes(error)
    ? { ok: false, message: cs.suggestions.stale, reload: true }
    : { ok: false, message: text[error], reload: false }
}

/** Hotovo or Zamítnout. */
export async function sendClose(
  call: CloseCall,
  input: { id: number; move: 'done' | 'dismiss' },
): Promise<AdminOutcome> {
  try {
    const r = await call({ data: input })
    return r.ok ? { ok: true } : refused(r.error, closeText)
  } catch {
    return { ok: false, message: e.generic, reload: false }
  }
}

/**
 * The confirm dialog's step after the answer: null hands it to the page (closed, or stale:
 * close, toast, reload); any other refusal is the message the dialog keeps for a retry.
 */
export function afterClose(outcome: AdminOutcome): string | null {
  return outcome.ok || outcome.reload ? null : outcome.message
}

/** GitHub made the issue but the app did not store it: show the link, never send it again. */
export interface NotSaved {
  ok: false
  notSaved: true
  url: string
}

/** Poslat na GitHub with the admin's edited preview. */
export async function sendIssue(
  call: SendCall,
  input: { id: number; title: string; body: string },
): Promise<AdminOutcome | NotSaved> {
  try {
    const r = await call({ data: input })
    if (r.ok) return { ok: true }
    if (r.error === 'sent_not_saved') return { ok: false, notSaved: true, url: r.url }
    return refused(r.error, sendText)
  } catch {
    return { ok: false, message: e.generic, reload: false }
  }
}

export type SendOutcome = AdminOutcome | NotSaved

/** The send sheet's guard: never without a token, while sending, or once GitHub has the issue. */
export function canSendIssue(s: {
  canSend: boolean
  busy: boolean
  notSavedUrl: string | null
}): boolean {
  return s.canSend && !s.busy && s.notSavedUrl === null
}

/**
 * The send sheet's next state from the server's answer. `settle` hands it to the page (sent,
 * stale, or made but not saved); any other refusal stays in the sheet with its message.
 */
export function afterSend(outcome: SendOutcome): {
  notSavedUrl: string | null
  error: string | null
  settle: boolean
} {
  if ('notSaved' in outcome) return { notSavedUrl: outcome.url, error: null, settle: true }
  if (!outcome.ok && !outcome.reload)
    return { notSavedUrl: null, error: outcome.message, settle: false }
  return { notSavedUrl: null, error: null, settle: true }
}

/** What Správa does once the send sheet settles. Made but not saved: the sheet keeps its link. */
export function settleSend(outcome: SendOutcome): {
  close: boolean
  toast: { kind: 'success' | 'error'; text: string } | null
} {
  if ('notSaved' in outcome) return { close: false, toast: null }
  return {
    close: true,
    toast: outcome.ok
      ? { kind: 'success', text: cs.suggestions.sentToast }
      : { kind: 'error', text: outcome.message },
  }
}

/** The send request from the admin's edited fields (never the draft again). */
export function issueInput(
  item: AdminSuggestion,
  edited: { title: string; body: string },
): { id: number; title: string; body: string } {
  return { id: item.id, title: edited.title, body: edited.body }
}
