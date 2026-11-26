import { describe, expect, it, vi } from 'vitest'
import { issueDraft } from '~/domain'
import { cs } from '~/lib/strings'
import type { AdminSuggestion } from '~/server/suggestions/functions'
import {
  afterSend,
  canSendIssue,
  checkSuggestion,
  issueInput,
  sendClose,
  sendIssue,
  sendNewSuggestion,
  settleSend,
} from './suggestionForms'

// The sheets' checks and the one place the suggestion screens reach the server (#247).
const t = cs.suggestions
const e = t.errors

const item: AdminSuggestion = {
  id: 5,
  title: 'Tmavý režim',
  description: 'I na Týdnu.',
  status: 'new',
  issueUrl: null,
  createdAt: '2026-11-25T10:00:00.000Z',
  author: { id: 3, displayName: 'Kuba' },
}

const refuse = <E extends string>(error: E) =>
  vi.fn(() => Promise.resolve({ ok: false as const, error }))
const thrown = () => vi.fn(() => Promise.reject(new Error('offline')))

describe('checkSuggestion', () => {
  it('a title of only spaces and line breaks is refused before sending', () => {
    expect(checkSuggestion({ title: ' \n ' })).toBe(e.title_empty)
  })

  it('a title with text passes', () => {
    expect(checkSuggestion({ title: 'a' })).toBeNull()
  })
})

describe('sendNewSuggestion', () => {
  const input = { title: 'Delší přestávka', description: 'Mezi úkoly.' }

  it('sends exactly { data } and answers null on success', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const, value: { id: 9 } }))
    await expect(sendNewSuggestion(call, input)).resolves.toBeNull()
    expect(call).toHaveBeenCalledWith({ data: input })
  })

  it.each([
    ['title_empty', e.title_empty],
    ['title_too_long', e.title_too_long],
    ['description_too_long', e.description_too_long],
    ['feature_off', e.feature_off],
  ] as const)('%s answers its Czech message', async (error, message) => {
    await expect(sendNewSuggestion(refuse(error), input)).resolves.toBe(message)
  })

  it('a failed request answers the generic message', async () => {
    await expect(sendNewSuggestion(thrown(), input)).resolves.toBe(e.generic)
  })
})

describe('sendClose', () => {
  const input = { id: 5, move: 'done' as const }

  it('sends exactly { data } and answers ok', async () => {
    const call = vi.fn(() => Promise.resolve({ ok: true as const, value: { id: 5 } }))
    await expect(sendClose(call, input)).resolves.toEqual({ ok: true })
    expect(call).toHaveBeenCalledWith({ data: input })
  })

  it.each(['not_found', 'closed', 'not_new'] as const)(
    '%s is stale: the list reloads',
    async (error) => {
      await expect(sendClose(refuse(error), input)).resolves.toEqual({
        ok: false,
        message: t.stale,
        reload: true,
      })
    },
  )

  it.each([
    ['not_admin', e.not_admin],
    ['busy', e.busy],
    ['feature_off', e.feature_off],
    ['title_empty', e.title_empty],
    ['title_too_long', e.title_too_long],
    ['description_too_long', e.description_too_long],
  ] as const)('%s stays in the dialog with its message', async (error, message) => {
    await expect(sendClose(refuse(error), input)).resolves.toEqual({
      ok: false,
      message,
      reload: false,
    })
  })

  it('a thrown call gives the generic text and stays', async () => {
    await expect(sendClose(thrown(), input)).resolves.toEqual({
      ok: false,
      message: e.generic,
      reload: false,
    })
  })
})

describe('sendIssue', () => {
  const input = { id: 5, title: 'Upraveno', body: 'Text.' }

  it('sends exactly { data } and answers ok', async () => {
    const call = vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { url: 'https://github.com/x/y/issues/1' } }),
    )
    await expect(sendIssue(call, input)).resolves.toEqual({ ok: true })
    expect(call).toHaveBeenCalledWith({ data: input })
  })

  it.each(['not_found', 'closed', 'not_new'] as const)(
    '%s is stale: the list reloads',
    async (error) => {
      await expect(sendIssue(refuse(error), input)).resolves.toEqual({
        ok: false,
        message: t.stale,
        reload: true,
      })
    },
  )

  it.each([
    ['not_admin', e.not_admin],
    ['busy', e.busy],
    ['feature_off', e.feature_off],
    ['title_empty', e.title_empty],
    ['title_too_long', e.title_too_long],
    ['description_too_long', e.description_too_long],
    ['body_too_long', e.body_too_long],
    ['no_token', t.noToken],
    ['github_failed', e.github_failed],
  ] as const)('%s stays in the sheet with its message', async (error, message) => {
    await expect(sendIssue(refuse(error), input)).resolves.toEqual({
      ok: false,
      message,
      reload: false,
    })
  })

  it('sent_not_saved answers the link so the admin does not send it again', async () => {
    const url = 'https://github.com/SlatinskyJ/taskmaster/issues/400'
    const call = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'sent_not_saved' as const, url }),
    )
    await expect(sendIssue(call, input)).resolves.toEqual({ ok: false, notSaved: true, url })
  })

  it('a thrown call gives the generic text and stays', async () => {
    await expect(sendIssue(thrown(), input)).resolves.toEqual({
      ok: false,
      message: e.generic,
      reload: false,
    })
  })
})

describe('afterSend: what the send sheet does with the answer', () => {
  const url = 'https://github.com/SlatinskyJ/taskmaster/issues/400'

  it('ok: the page settles (closes, toasts), no error, no link', () => {
    expect(afterSend({ ok: true })).toEqual({ notSavedUrl: null, error: null, settle: true })
  })

  it('a stale refusal: the page settles (closes, toasts, reloads)', () => {
    expect(afterSend({ ok: false, message: t.stale, reload: true })).toEqual({
      notSavedUrl: null,
      error: null,
      settle: true,
    })
  })

  it('another refusal stays in the sheet with its message', () => {
    expect(afterSend({ ok: false, message: e.github_failed, reload: false })).toEqual({
      notSavedUrl: null,
      error: e.github_failed,
      settle: false,
    })
  })

  it('sent_not_saved shows the link and lets the page reload the list', () => {
    expect(afterSend({ ok: false, notSaved: true, url })).toEqual({
      notSavedUrl: url,
      error: null,
      settle: true,
    })
  })

  it('after sent_not_saved a second send is blocked', () => {
    const { notSavedUrl } = afterSend({ ok: false, notSaved: true, url })
    expect(canSendIssue({ canSend: true, busy: false, notSavedUrl })).toBe(false)
  })

  it('after another refusal the admin can send again', () => {
    const { notSavedUrl } = afterSend({ ok: false, message: e.busy, reload: false })
    expect(canSendIssue({ canSend: true, busy: false, notSavedUrl })).toBe(true)
  })
})

describe("canSendIssue: the send sheet's guard", () => {
  it('with a token, not busy, nothing sent yet: may send', () => {
    expect(canSendIssue({ canSend: true, busy: false, notSavedUrl: null })).toBe(true)
  })

  it.each([
    ['no token', { canSend: false, busy: false, notSavedUrl: null }],
    ['busy', { canSend: true, busy: true, notSavedUrl: null }],
    ['issue made, not saved', { canSend: true, busy: false, notSavedUrl: 'https://x' }],
  ])('%s: blocked', (_, state) => {
    expect(canSendIssue(state)).toBe(false)
  })
})

describe('settleSend: what Správa does once the sheet settles', () => {
  it('sent: closes the sheet with the sent toast', () => {
    expect(settleSend({ ok: true })).toEqual({
      close: true,
      toast: { kind: 'success', text: t.sentToast },
    })
  })

  it('stale: closes the sheet with the stale toast', () => {
    expect(settleSend({ ok: false, message: t.stale, reload: true })).toEqual({
      close: true,
      toast: { kind: 'error', text: t.stale },
    })
  })

  it('issue made, not saved: the sheet stays open with its link, no toast', () => {
    expect(settleSend({ ok: false, notSaved: true, url: 'https://x' })).toEqual({
      close: false,
      toast: null,
    })
  })
})

describe('issueInput', () => {
  it("sends the admin's edited fields, not the draft again", () => {
    const edited = { title: 'Edited', body: 'Edited body' }
    expect(issueInput(item, edited)).toEqual({ id: item.id, title: 'Edited', body: 'Edited body' })
    expect(issueDraft(item)).not.toEqual(edited)
  })
})

describe('adminTitle', () => {
  it.each([
    [0, 'Návrhy'],
    [1, 'Návrhy · 1 nový'],
    [2, 'Návrhy · 2 nové'],
    [4, 'Návrhy · 4 nové'],
    [5, 'Návrhy · 5 nových'],
    [21, 'Návrhy · 21 nových'],
  ])('%d new → %s', (n, label) => {
    expect(t.adminTitle(n)).toBe(label)
  })
})
