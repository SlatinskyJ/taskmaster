import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { issueDraft } from '~/domain'
import { cs } from '~/lib/strings'
import type { AdminSuggestion } from '~/server/suggestions/functions'
import { CloseForm } from './CloseSuggestionDialog'
import { SendForm, SendPreview } from './SendSuggestionDrawer'
import { loadAdminSuggestions, SuggestionsCard } from './SuggestionsCard'

// Návrhy on Správa (#247): rows, states and the two confirm surfaces, as static markup. Taps
// are in e2e/suggestions.spec.ts.
vi.mock('~/components/ui/dialog', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Dialog: Pass,
    DialogContent: Pass,
    DialogHeader: Pass,
    DialogFooter: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
    DialogClose: Pass,
  }
})

const t = cs.suggestions
const noop = () => undefined
const url = 'https://github.com/SlatinskyJ/taskmaster/issues/301'

const row = (over: Partial<AdminSuggestion> & { id: number }): AdminSuggestion => ({
  title: `Návrh ${String(over.id)}`,
  description: null,
  status: 'new',
  issueUrl: null,
  createdAt: '2026-11-25T10:00:00.000Z',
  author: { id: 3, displayName: 'Kuba' },
  ...over,
})

const card = (data: Parameters<typeof SuggestionsCard>[0]['data']) =>
  renderToStaticMarkup(<SuggestionsCard data={data} onClose={noop} onSend={noop} onRetry={noop} />)

/** The markup of one row, by its data attribute. */
const rowHtml = (html: string, id: number) => {
  const start = html.indexOf(`data-suggestion="${String(id)}"`)
  const end = html.indexOf('</li>', start)
  return html.slice(start, end)
}
const buttons = (html: string) =>
  [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])

describe('loadAdminSuggestions', () => {
  it('a request that throws becomes the retry state', async () => {
    await expect(loadAdminSuggestions(() => Promise.reject(new Error('offline')))).resolves.toEqual(
      { error: 'load' },
    )
  })

  it('passes feature_off and the list through', async () => {
    await expect(
      loadAdminSuggestions(() => Promise.resolve({ error: 'feature_off' as const })),
    ).resolves.toEqual({ error: 'feature_off' })
    const list = { items: [row({ id: 1 })], canSend: false }
    await expect(loadAdminSuggestions(() => Promise.resolve(list))).resolves.toEqual(list)
  })
})

describe('SuggestionsCard', () => {
  const items = [
    row({ id: 5, status: 'new' }),
    row({ id: 4, status: 'new', author: { id: 5, displayName: 'Starší' } }),
    row({ id: 3, status: 'new' }),
    row({ id: 2, status: 'sent', issueUrl: url }),
    row({ id: 1, status: 'done' }),
  ]

  it('with the switch off renders nothing', () => {
    expect(card({ error: 'feature_off' })).toBe('')
  })

  it('the label counts the new ones: 3 new, 1 sent, 1 done', () => {
    expect(card({ items, canSend: false })).toContain('Návrhy · 3 nové')
  })

  it('a new row offers Hotovo, Zamítnout and Poslat na GitHub', () => {
    expect(buttons(rowHtml(card({ items, canSend: false }), 4))).toEqual([
      t.done,
      t.dismiss,
      t.sendRow,
    ])
  })

  it('a sent row offers only Hotovo, and links to its issue', () => {
    const html = rowHtml(card({ items, canSend: false }), 2)
    expect(buttons(html)).toEqual([t.done])
    expect(html).toContain(`<a href="${url}" target="_blank" rel="noopener noreferrer"`)
  })

  it('a done row has no buttons', () => {
    expect(buttons(rowHtml(card({ items, canSend: false }), 1))).toEqual([])
  })

  it('shows who wrote each one', () => {
    const html = card({ items, canSend: false })
    expect(rowHtml(html, 4)).toContain('Starší')
    expect(rowHtml(html, 3)).toContain('Kuba')
  })

  it('long text wraps, never cut', () => {
    const long = 'x'.repeat(120)
    const html = card({ items: [row({ id: 7, title: long, description: 'a\nb' })], canSend: true })
    expect(html).toContain(long)
    expect(html).not.toContain('truncate')
    expect(html).toContain('whitespace-pre-line')
  })

  it('a failed load shows the error and Zkusit znovu', () => {
    const html = card({ error: 'load' })
    expect(html).toContain(t.loadError)
    expect(html).toContain('role="alert"')
    expect(buttons(html)).toEqual([t.retry])
  })

  it('no suggestions: the empty line', () => {
    const html = card({ items: [], canSend: true })
    expect(html).toContain(t.adminEmpty)
    expect(html).toContain('>Návrhy<')
  })
})

describe('SendPreview', () => {
  const item = row({
    id: 8,
    title: 'Tmavý režim',
    description: 'I na Týdnu.',
    author: { id: 3, displayName: 'Kuba' },
  })
  const preview = (canSend: boolean) =>
    renderToStaticMarkup(
      <SendPreview
        item={item}
        canSend={canSend}
        onSend={() => Promise.resolve({ ok: true })}
        onSettled={noop}
      />,
    )

  it('without a token: says so and the send button is disabled', () => {
    const html = preview(false)
    expect(html).toContain(t.noToken)
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/)
  })

  it('with a token: the button is enabled and no token note', () => {
    const html = preview(true)
    expect(html).not.toContain(t.noToken)
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/)
  })

  it("the fields hold the draft and never the author's name, under the public note", () => {
    const html = preview(true)
    const draft = issueDraft(item)
    expect(html).toContain(`value="${draft.title}"`)
    expect(html).toContain(`>${draft.body}</textarea>`)
    expect(html).not.toContain('Kuba')
    expect(html).toContain(t.publicNote)
  })
})

describe('SendForm', () => {
  it('issue made, not saved: the link and a disabled button', () => {
    const html = renderToStaticMarkup(
      <SendForm
        fields={{ title: 'A', body: '' }}
        canSend
        busy={false}
        error={null}
        notSavedUrl={url}
        onField={noop}
        onSend={noop}
      />,
    )
    expect(html).toContain(t.notSaved)
    expect(html).toContain(`href="${url}"`)
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/)
  })

  it('another refusal shows its alert and leaves the button for a retry', () => {
    const html = renderToStaticMarkup(
      <SendForm
        fields={{ title: 'A', body: '' }}
        canSend
        busy={false}
        error={t.errors.github_failed}
        notSavedUrl={null}
        onField={noop}
        onSend={noop}
      />,
    )
    expect(html).toContain(t.errors.github_failed)
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/)
  })
})

describe('CloseForm', () => {
  it('Hotovo asks first, says it is final, and shows both buttons with an error', () => {
    const html = renderToStaticMarkup(
      <CloseForm move="done" busy={false} error={t.errors.busy} onConfirm={noop} />,
    )
    expect(html).toContain(t.confirmDone)
    expect(html).toContain(t.confirmFinal)
    expect(html).toContain('role="alert"')
    expect(html).toContain(t.errors.busy)
    expect(buttons(html)).toEqual([t.cancel, t.done])
  })

  it('Zamítnout asks its own question', () => {
    const html = renderToStaticMarkup(
      <CloseForm move="dismiss" busy={false} error={null} onConfirm={noop} />,
    )
    expect(html).toContain(t.confirmDismiss)
    expect(buttons(html)).toEqual([t.cancel, t.dismiss])
  })
})
