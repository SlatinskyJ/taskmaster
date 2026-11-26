import type { Result } from './result'
import { fail, ok } from './result'

// In-app suggestions (spec §5.13, #247). Anyone signed in suggests; only the admin moves one on:
// new → sent (a GitHub issue) or dismissed; new or sent → done. Done and dismissed are final.
// The suggestion's own text never changes; what was sent to GitHub is kept beside it.

/** Limits in characters (code points), the unit SQLite's `length()` counts in the checks. */
export const SUGGESTION_TITLE_MAX = 120
export const SUGGESTION_DESCRIPTION_MAX = 2000
/** The issue body the admin sends, before the footer (ruling 2). */
export const ISSUE_BODY_MAX = 4000

export type SuggestionStatus = 'new' | 'sent' | 'done' | 'dismissed'
export type SuggestionMove = 'send' | 'done' | 'dismiss'
export type SuggestionTextError = 'title_empty' | 'title_too_long' | 'description_too_long'
export type IssueTextError = 'title_empty' | 'title_too_long' | 'body_too_long'

/** The one line the server adds to every issue body; it names nobody (ruling 2). */
export const ISSUE_FOOTER = '_Suggested in the Taskmaster app._'

// The description rule's set (C0 controls except TAB and LF, DEL, bidi embeddings, overrides
// and isolates) plus zero-width and direction marks U+200B–U+200F, U+2060 and U+FEFF
// (ruling 1).
const HIDDEN_IN_SUGGESTION =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g

/** Characters as code points: `'😀'` is one. */
export const charCount = (text: string): number => Array.from(text).length

/**
 * The stored form of a suggestion's text: line breaks as LF, hidden characters removed, then
 * trimmed. A one-line text (a title) has its line breaks and tabs turned into spaces.
 */
export function cleanSuggestionText(raw: string, oneLine: boolean): string {
  const text = raw.replace(/\r\n?/g, '\n').replace(HIDDEN_IN_SUGGESTION, '')
  return (oneLine ? text.replace(/[\n\t]/g, ' ') : text).trim()
}

function cleanTitle(raw: string): Result<string, 'title_empty' | 'title_too_long'> {
  const title = cleanSuggestionText(raw, true)
  if (title === '') return fail('title_empty')
  if (charCount(title) > SUGGESTION_TITLE_MAX) return fail('title_too_long')
  return ok(title)
}

/** A new suggestion as stored: title 1–120, description up to 2000 or `null` when empty. */
export function normaliseSuggestion(raw: {
  title: string
  description: string
}): Result<{ title: string; description: string | null }, SuggestionTextError> {
  const title = cleanTitle(raw.title)
  if (!title.ok) return title
  const description = cleanSuggestionText(raw.description, false)
  if (charCount(description) > SUGGESTION_DESCRIPTION_MAX) return fail('description_too_long')
  return ok({ title: title.value, description: description === '' ? null : description })
}

/** The admin's issue text as sent: title 1–120, body up to 4000 (may be empty). */
export function normaliseIssue(raw: {
  title: string
  body: string
}): Result<{ title: string; body: string }, IssueTextError> {
  const title = cleanTitle(raw.title)
  if (!title.ok) return title
  const body = cleanSuggestionText(raw.body, false)
  if (charCount(body) > ISSUE_BODY_MAX) return fail('body_too_long')
  return ok({ title: title.value, body })
}

/** Where a move takes a suggestion, or why it can't. */
export function nextStatus(
  from: SuggestionStatus,
  move: SuggestionMove,
): Result<SuggestionStatus, 'not_new' | 'closed'> {
  if (from === 'done' || from === 'dismissed') return fail('closed')
  if (move === 'done') return ok('done')
  if (from !== 'new') return fail('not_new')
  return ok(move === 'send' ? 'sent' : 'dismissed')
}

/** The send preview: the suggestion's own title and description, without the author's name. */
export function issueDraft(s: { title: string; description: string | null }): {
  title: string
  body: string
} {
  return { title: s.title, body: s.description ?? '' }
}

/** The body as sent: the admin's text, a blank line and the footer; only the footer if empty. */
export function issueBody(body: string): string {
  return body === '' ? ISSUE_FOOTER : `${body}\n\n${ISSUE_FOOTER}`
}
