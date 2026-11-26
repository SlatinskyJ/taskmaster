import { and, eq } from 'drizzle-orm'
import { toIsoUtc } from '~/domain/dates'
import type { IssueTextError } from '~/domain'
import { issueBody, nextStatus, normaliseIssue } from '~/domain'
import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'
import { writeAudit } from '~/server/audit'
import type { Db } from '~/server/db'
import { suggestions } from '~/server/db/schema'
import { listPeople } from '~/server/users/people'
import { createIssue } from './github'
import type { FetchFn } from './github'
import { claimSend, releaseSend } from './sending'
import { isActiveAdmin } from './store'
import type { SuggestionError } from './store'

// The admin sends a new suggestion to GitHub as an issue (spec §5.13). The text is the admin's
// edited preview plus the footer; the suggestion's own text stays as written. GitHub failing
// changes nothing. At most once: the claim in ./sending stops a second send while GitHub
// answers, and the update requires the row still new.

export type SendError = SuggestionError | IssueTextError | 'no_token' | 'github_failed'

/** GitHub made the issue but the app could not store it (ruling 7): show the link, don't resend. */
export interface SentNotSaved {
  ok: false
  error: 'sent_not_saved'
  url: string
}

export async function sendSuggestion(
  db: Db,
  adminId: number,
  id: number,
  draft: { title: string; body: string },
  token: string | null,
  now: Date = new Date(),
  fetchFn?: FetchFn,
): Promise<Result<{ url: string }, SendError> | SentNotSaved> {
  if (token === null) return fail('no_token')
  if (!claimSend(id)) return fail('busy')
  try {
    const checked = db.transaction((tx) => {
      if (!isActiveAdmin(listPeople(tx), adminId)) return fail('not_admin')
      const row = tx
        .select({ status: suggestions.status })
        .from(suggestions)
        .where(eq(suggestions.id, id))
        .get()
      if (!row) return fail('not_found')
      return nextStatus(row.status, 'send')
    })
    if (!checked.ok) return checked
    const text = normaliseIssue(draft)
    if (!text.ok) return text
    const body = issueBody(text.value.body)
    const issue = await createIssue(token, { title: text.value.title, body }, fetchFn)
    if (!issue.ok) return issue
    const { url, number } = issue.value
    const notSaved: SentNotSaved = { ok: false, error: 'sent_not_saved', url }
    try {
      const saved = db.transaction((tx) => {
        const changed = tx
          .update(suggestions)
          .set({
            status: 'sent',
            issueUrl: url,
            issueNumber: number,
            sentTitle: text.value.title,
            sentBody: body,
            sentAt: toIsoUtc(now),
          })
          .where(and(eq(suggestions.id, id), eq(suggestions.status, 'new')))
          .run()
        if (changed.changes === 0) return false
        writeAudit(tx, {
          actor: { kind: 'user', userId: adminId },
          action: 'suggestion.sent',
          entityType: 'suggestion',
          entityId: id,
          before: { status: 'new' },
          after: {
            status: 'sent',
            issueUrl: url,
            issueNumber: number,
            title: text.value.title,
            body,
          },
          at: now,
        })
        return true
      })
      if (saved) return ok({ url })
    } catch {
      // Logged below with what the admin needs; the error itself may hold row text.
    }
    console.error('suggestions: issue created but not saved', { id, number, url })
    return notSaved
  } finally {
    releaseSend(id)
  }
}
