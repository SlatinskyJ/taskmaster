import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import type { MySuggestion } from '~/server/suggestions/functions'
import { MySuggestions } from './MySuggestions'
import { loadMine, ProfileSuggestions } from './ProfileSuggestions'
import { StatusChip } from './StatusChip'

// Profil → Nápady na zlepšení (#247): static markup only; typing and sending are in
// e2e/suggestions.spec.ts.
const t = cs.suggestions
const noop = () => undefined

const mine = (over: Partial<MySuggestion> & { id: number; title: string }): MySuggestion => ({
  description: null,
  status: 'new',
  issueUrl: null,
  createdAt: '2026-11-25T10:00:00.000Z',
  ...over,
})

const render = (data: Parameters<typeof ProfileSuggestions>[0]['data'], enabled = true) =>
  renderToStaticMarkup(<ProfileSuggestions enabled={enabled} data={data} onReload={noop} />)

describe('ProfileSuggestions', () => {
  it('with the switch off renders nothing', () => {
    expect(render([], false)).toBe('')
  })

  it('a server answering feature_off renders nothing', () => {
    expect(render({ error: 'feature_off' })).toBe('')
  })

  it('a failed load shows the error and Zkusit znovu, and still offers the row', () => {
    const html = render({ error: 'load' })
    expect(html).toContain(t.loadError)
    expect(html).toContain('role="alert"')
    expect(html).toMatch(new RegExp(`<button[^>]*>${t.retry}</button>`))
    expect(html).toContain(t.row)
  })

  it('no suggestions yet: the section, the row and the empty line', () => {
    const html = render([])
    expect(html).toContain(t.section)
    expect(html).toContain(t.row)
    expect(html).toContain(t.mine)
    expect(html).toContain(t.mineEmpty)
  })
})

describe('MySuggestions', () => {
  const url = 'https://github.com/SlatinskyJ/taskmaster/issues/300'
  const items = [
    mine({ id: 3, title: 'Třetí', status: 'sent', issueUrl: url }),
    mine({ id: 2, title: 'Druhý', status: 'done' }),
    mine({ id: 1, title: 'První', status: 'dismissed', description: 'Řádek 1\nŘádek 2' }),
  ]

  it('lists each title with its state, in the order given (newest first)', () => {
    const html = renderToStaticMarkup(<MySuggestions items={items} />)
    const at = (s: string) => html.indexOf(s)
    expect(at('Třetí')).toBeGreaterThan(-1)
    expect(at('Třetí')).toBeLessThan(at('Druhý'))
    expect(at('Druhý')).toBeLessThan(at('První'))
    expect(html).toContain(t.status.sent)
    expect(html).toContain(t.status.done)
    expect(html).toContain(t.status.dismissed)
  })

  it('a sent one links to its issue in a new tab', () => {
    const html = renderToStaticMarkup(<MySuggestions items={items} />)
    expect(html).toContain(`<a href="${url}" target="_blank" rel="noopener noreferrer"`)
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toContain(`>${t.issueLink}</a>`)
  })

  it('the link reads apart from the Na GitHubu chip on the same row', () => {
    expect(t.issueLink).toBe('Otevřít na GitHubu')
    expect(t.issueLink).not.toBe(t.status.sent)
  })

  it('long text is never cut: a 120-character title whole, line breaks kept', () => {
    const long = 'Dlouhý název '.repeat(10).slice(0, 120)
    const html = renderToStaticMarkup(
      <MySuggestions items={[mine({ id: 9, title: long, description: 'a\nb' })]} />,
    )
    expect(html).toContain(long)
    expect(html).not.toContain('truncate')
    expect(html).not.toContain('line-clamp')
    expect(html).toContain('whitespace-pre-line')
    expect(html).toContain('break-words')
  })
})

describe('StatusChip', () => {
  it.each([
    ['new', 'bg-state-open/15'],
    ['sent', 'bg-state-pending/15'],
    ['done', 'bg-state-confirmed/15'],
    ['dismissed', 'bg-state-cancelled/15'],
  ] as const)('%s uses its state colour and Czech label', (status, bg) => {
    const html = renderToStaticMarkup(<StatusChip status={status} />)
    expect(html).toContain(bg)
    expect(html).toContain(t.status[status])
  })
})

describe('loadMine', () => {
  it('a request that throws becomes the retry state', async () => {
    await expect(loadMine(() => Promise.reject(new Error('offline')))).resolves.toEqual({
      error: 'load',
    })
  })

  it('passes the list and feature_off through', async () => {
    await expect(loadMine(() => Promise.resolve([]))).resolves.toEqual([])
    await expect(
      loadMine(() => Promise.resolve({ error: 'feature_off' as const })),
    ).resolves.toEqual({ error: 'feature_off' })
  })
})
