import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toIsoUtc } from '~/domain/dates'
import { ISSUE_FOOTER, issueDraft } from '~/domain'
import { auditLog, suggestions, users } from '~/server/db/schema'
import { failAuditOn, family, must, T0, T1 } from '~/server/tasks/testing'
import type { FetchFn } from './github'
import { sendSuggestion } from './send'
import { isSending } from './sending'
import { closeSuggestionIn, createSuggestionIn } from './store'

// Sending a suggestion to GitHub (spec §5.13, rulings 4, 5 and 7).
const TOKEN = 'github_pat_SECRET123'
const NOW = T1
const URL_OK = 'https://github.com/SlatinskyJ/taskmaster/issues/301'
const EDITED = { title: 'Edited', body: 'Edited body' }

interface Call {
  url: string
  init: RequestInit
}

function fakeFetch(answer: (call: Call) => Promise<Response> = () => created()) {
  const calls: Call[] = []
  const fn = ((url: string, init: RequestInit) => {
    const call = { url, init }
    calls.push(call)
    return answer(call)
  }) as unknown as FetchFn
  return { fn, calls }
}

const created = () =>
  Promise.resolve(new Response(JSON.stringify({ number: 301, html_url: URL_OK }), { status: 201 }))
const status = (code: number) => () => Promise.resolve(new Response('{}', { status: code }))

function setup() {
  const f = family()
  f.db.update(users).set({ displayName: 'Kuba' }).where(eq(users.id, f.starsi)).run()
  const id = must(
    createSuggestionIn(f.db, f.starsi, { title: 'Tmavý režim', description: 'Večer svítí.' }, T0),
  ).id
  const row = () => f.db.select().from(suggestions).where(eq(suggestions.id, id)).get()
  const sentEntries = () =>
    f.db.select().from(auditLog).where(eq(auditLog.action, 'suggestion.sent')).all()
  return { ...f, id, row, sentEntries }
}

const sentBody = (call: Call | undefined) =>
  JSON.parse(call?.init.body as string) as { title: string; body: string }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sendSuggestion', () => {
  it('sends the edited draft and stores the issue and the text as sent', async () => {
    const f = setup()
    const { fn, calls } = fakeFetch()
    expect(await sendSuggestion(f.db, f.admin, f.id, EDITED, TOKEN, NOW, fn)).toEqual({
      ok: true,
      value: { url: URL_OK },
    })
    expect(calls).toHaveLength(1)
    const body = `Edited body\n\n${ISSUE_FOOTER}`
    expect(sentBody(calls[0])).toStrictEqual({ title: 'Edited', body })
    expect(f.row()).toMatchObject({
      status: 'sent',
      title: 'Tmavý režim',
      description: 'Večer svítí.',
      issueUrl: URL_OK,
      issueNumber: 301,
      sentTitle: 'Edited',
      sentBody: body,
      sentAt: toIsoUtc(NOW),
      closedBy: null,
    })
    const entries = f.sentEntries()
    expect(entries).toStrictEqual([
      {
        id: entries[0]?.id,
        at: toIsoUtc(NOW),
        actorKind: 'user',
        actorUserId: f.admin,
        action: 'suggestion.sent',
        entityType: 'suggestion',
        entityId: String(f.id),
        before: JSON.stringify({ status: 'new' }),
        after: JSON.stringify({
          status: 'sent',
          issueUrl: URL_OK,
          issueNumber: 301,
          title: 'Edited',
          body,
        }),
        reason: null,
      },
    ])
    expect(isSending(f.id)).toBe(false)
  })

  it("never sends the author's name when the draft is the preview", async () => {
    const f = setup()
    const row = f.row()
    if (!row) throw new Error('no row')
    const { fn, calls } = fakeFetch()
    must(await sendSuggestion(f.db, f.admin, f.id, issueDraft(row), TOKEN, NOW, fn))
    expect(calls[0]?.init.body).not.toContain('Kuba')
    expect(sentBody(calls[0])).toStrictEqual({
      title: 'Tmavý režim',
      body: `Večer svítí.\n\n${ISSUE_FOOTER}`,
    })
  })

  it('cleans the draft before sending', async () => {
    const f = setup()
    const { fn, calls } = fakeFetch()
    must(await sendSuggestion(f.db, f.admin, f.id, { title: ' A\nB ', body: '' }, TOKEN, NOW, fn))
    expect(sentBody(calls[0])).toStrictEqual({ title: 'A B', body: ISSUE_FOOTER })
  })

  it('is unavailable without a token and calls nobody', async () => {
    const f = setup()
    const { fn, calls } = fakeFetch()
    expect(await sendSuggestion(f.db, f.admin, f.id, EDITED, null, NOW, fn)).toEqual({
      ok: false,
      error: 'no_token',
    })
    expect(calls).toHaveLength(0)
    expect(isSending(f.id)).toBe(false)
  })

  it('changes nothing when GitHub fails, and a retry then succeeds', async () => {
    const f = setup()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(
      await sendSuggestion(f.db, f.admin, f.id, EDITED, TOKEN, NOW, fakeFetch(status(500)).fn),
    ).toEqual({ ok: false, error: 'github_failed' })
    expect(f.row()).toMatchObject({ status: 'new', issueUrl: null, sentTitle: null })
    expect(f.sentEntries()).toHaveLength(0)
    expect(isSending(f.id)).toBe(false)
    const retry = fakeFetch()
    expect(await sendSuggestion(f.db, f.admin, f.id, EDITED, TOKEN, NOW, retry.fn)).toEqual({
      ok: true,
      value: { url: URL_OK },
    })
    expect(retry.calls).toHaveLength(1)
  })

  it('lets one of two sends started together through, the other is busy', async () => {
    const f = setup()
    let answer: (r: Response) => void = () => undefined
    const { fn, calls } = fakeFetch(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve
        }),
    )
    const first = sendSuggestion(f.db, f.admin, f.id, EDITED, TOKEN, NOW, fn)
    const second = sendSuggestion(f.db, f.admin, f.id, EDITED, TOKEN, NOW, fn)
    expect(await second).toEqual({ ok: false, error: 'busy' })
    expect(isSending(f.id)).toBe(true)
    expect(closeSuggestionIn(f.db, f.admin, f.id, 'done', NOW)).toEqual({
      ok: false,
      error: 'busy',
    })
    answer(new Response(JSON.stringify({ number: 301, html_url: URL_OK }), { status: 201 }))
    expect(await first).toEqual({ ok: true, value: { url: URL_OK } })
    expect(calls).toHaveLength(1)
    expect(isSending(f.id)).toBe(false)
    expect(f.sentEntries()).toHaveLength(1)
  })

  it.each([
    ['not_new', 'a sent one'],
    ['not_found', 'an unknown id'],
    ['not_admin', "a giver's send"],
    ['not_admin', "a taker's send"],
    ['title_empty', 'an empty draft title'],
    ['title_too_long', 'a draft title over 120'],
    ['body_too_long', 'a draft body over 4000'],
    ['closed', 'a dismissed one'],
  ] as const)('refuses %s (%s) and calls nobody', async (error, name) => {
    const f = setup()
    const first = fakeFetch()
    let id = f.id
    let actor = f.admin
    let draft: { title: string; body: string } = EDITED
    if (name === 'a sent one')
      must(await sendSuggestion(f.db, f.admin, id, EDITED, TOKEN, NOW, first.fn))
    if (name === 'an unknown id') id = 999
    if (name === "a giver's send") actor = f.tata
    if (name === "a taker's send") actor = f.starsi
    if (name === 'an empty draft title') draft = { title: ' ​ ', body: 'x' }
    if (name === 'a draft title over 120') draft = { title: 'a'.repeat(121), body: '' }
    if (name === 'a draft body over 4000') draft = { title: 'T', body: 'b'.repeat(4001) }
    if (name === 'a dismissed one') must(closeSuggestionIn(f.db, f.admin, id, 'dismiss', NOW))
    const before = f.db.select().from(auditLog).all().length
    const { fn, calls } = fakeFetch()
    expect(await sendSuggestion(f.db, actor, id, draft, TOKEN, NOW, fn)).toEqual({
      ok: false,
      error,
    })
    expect(calls).toHaveLength(0)
    expect(f.db.select().from(auditLog).all()).toHaveLength(before)
    expect(isSending(id)).toBe(false)
  })

  it('stores nothing and answers the link when saving fails after GitHub made the issue', async () => {
    const f = setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    failAuditOn(f.db, 'suggestion.sent')
    expect(await sendSuggestion(f.db, f.admin, f.id, EDITED, TOKEN, NOW, fakeFetch().fn)).toEqual({
      ok: false,
      error: 'sent_not_saved',
      url: URL_OK,
    })
    expect(f.row()).toMatchObject({ status: 'new', issueUrl: null, sentTitle: null })
    expect(f.sentEntries()).toHaveLength(0)
    expect(isSending(f.id)).toBe(false)
    expect(log).toHaveBeenCalledWith('suggestions: issue created but not saved', {
      id: f.id,
      number: 301,
      url: URL_OK,
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
  })

  it('answers sent_not_saved when the row moved on while GitHub answered', async () => {
    const f = setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { fn } = fakeFetch(() => {
      f.db
        .update(suggestions)
        .set({
          status: 'sent',
          issueUrl: 'https://github.com/SlatinskyJ/taskmaster/issues/300',
          issueNumber: 300,
          sentTitle: 'Jiný',
          sentBody: 'Jiný',
          sentAt: toIsoUtc(T0),
        })
        .where(eq(suggestions.id, f.id))
        .run()
      return created()
    })
    expect(await sendSuggestion(f.db, f.admin, f.id, EDITED, TOKEN, NOW, fn)).toEqual({
      ok: false,
      error: 'sent_not_saved',
      url: URL_OK,
    })
    expect(f.row()?.issueNumber).toBe(300)
    expect(f.sentEntries()).toHaveLength(0)
    expect(isSending(f.id)).toBe(false)
    expect(log).toHaveBeenCalledWith('suggestions: issue created but not saved', {
      id: f.id,
      number: 301,
      url: URL_OK,
    })
  })
})
