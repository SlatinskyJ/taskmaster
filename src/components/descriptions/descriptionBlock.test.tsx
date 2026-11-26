import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { Me } from '~/components/tasks/taskView'
import type { WaitingDescription } from '~/server/descriptions/functions'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/server/descriptions/functions', () => ({
  changeDescriptionFn: vi.fn(),
  answerDescriptionFn: vi.fn(),
}))

const { DescriptionBlock } = await import('./DescriptionBlock')
const { DescriptionForm } = await import('./DescriptionForm')
const { WaitingCard } = await import('./WaitingDescription')
const { sheetStart } = await import('./descriptionCalls')

const tata: Me = { id: 1, role: 'giver' }
const starsi: Me = { id: 3, role: 'taker' }
const mladsi: Me = { id: 4, role: 'taker' }
const target = { kind: 'task', id: 7 } as const
const change: WaitingDescription = {
  id: 5,
  description: 'Umýt i kola.\nA vysát.',
  proposedBy: 1,
  createdAt: '2026-11-26T10:00:00.000Z',
  waitingFor: [3],
  waitingForNames: ['Starší'],
}

const block = (p: Partial<Parameters<typeof DescriptionBlock>[0]>) =>
  renderToStaticMarkup(
    <DescriptionBlock
      text="Umýt auto.\nI kufr."
      change={null}
      target={target}
      canEdit={false}
      proposed={false}
      me={starsi}
      {...p}
    />,
  )

const card = (me: Me, c = change) =>
  renderToStaticMarkup(
    <WaitingCard change={c} me={me} busy={null} onAnswer={vi.fn()} onTakeBack={vi.fn()} />,
  )

describe('DescriptionBlock', () => {
  it('shows the text as plain text with its line breaks', () => {
    const html = block({ text: 'Řádek 1\nŘádek 2 <b>tučně</b>' })
    expect(html).toContain(`>${cs.description.label}<`)
    expect(html).toMatch(/<p class="[^"]*whitespace-pre-line[^"]*">Řádek 1\nŘádek 2 &lt;b&gt;/)
    expect(html).not.toContain('<b>')
  })

  it('a parent who may edit sees Upravit popis (44 px); a brother does not', () => {
    expect(block({ canEdit: true, me: tata })).toMatch(
      /<button[^>]*class="[^"]*min-h-tap[^"]*"[^>]*>Upravit popis</,
    )
    expect(block({})).not.toContain(cs.description.edit)
  })

  it('no text: Přidat popis for a parent; nothing at all for a brother', () => {
    const html = block({ text: null, canEdit: true, me: tata })
    expect(html).toContain(`>${cs.description.add}<`)
    expect(html).toContain(cs.description.none)
    expect(block({ text: null })).toBe('')
  })

  it('a waiting change shows its card under the text', () => {
    const html = block({ change })
    expect(html).toContain(cs.description.waitingTitle)
    expect(html).toContain('Umýt i kola.\nA vysát.')
  })
})

describe('WaitingCard', () => {
  it('a brother it waits for: yes and no; Čeká na with names', () => {
    const html = card(starsi)
    expect(html).toContain(`>${cs.description.agree}<`)
    expect(html).toContain(`>${cs.description.decline}<`)
    expect(html).toContain('Čeká na: Starší')
    expect(html).not.toContain(cs.description.takeBack)
  })

  it('another brother: no buttons', () => {
    const html = card(mladsi)
    expect(html).not.toContain('<button')
  })

  it('a parent: only Vzít zpět', () => {
    const html = card(tata)
    expect(html).toContain(`>${cs.description.takeBack}<`)
    expect(html).not.toContain(cs.description.agree)
  })

  it('a removal shows Návrh: popis odebrat', () => {
    expect(card(starsi, { ...change, description: null })).toContain(cs.description.waitingRemove)
  })

  it('busy: every button disabled, the pressed one aria-busy', () => {
    const html = renderToStaticMarkup(
      <WaitingCard
        change={change}
        me={starsi}
        busy="yes"
        onAnswer={vi.fn()}
        onTakeBack={vi.fn()}
      />,
    )
    expect(html.match(/disabled=""/g)).toHaveLength(2)
    expect(html).toMatch(/aria-busy="true"[^>]*>Souhlasím s popisem</)
  })
})

describe('Vzít zpět sends the text in force (ruling 7)', () => {
  it.each([
    ['Starý text', 'Starý text'],
    [null, ''],
  ] as const)('in force %s → sends %j', async (inForce, sent) => {
    const { takeBackDescription } = await import('./descriptionCalls')
    const fn = vi.fn(() => Promise.resolve({ ok: true as const, outcome: 'withdrawn' as const }))
    await expect(takeBackDescription(target, inForce, fn)).resolves.toEqual({
      ok: true,
      outcome: 'withdrawn',
    })
    expect(fn).toHaveBeenCalledWith({ data: { ...target, description: sent } })
  })
})

describe('DescriptionForm', () => {
  const form = (p: Partial<Parameters<typeof DescriptionForm>[0]>) =>
    renderToStaticMarkup(
      <DescriptionForm
        text="Umýt i kola"
        warn={cs.description.waitWarn}
        busy={false}
        error={null}
        onText={vi.fn()}
        onSave={vi.fn()}
        {...p}
      />,
    )

  it('textarea capped at 1000, the count reads "11 / 1000", the warning shown', () => {
    const html = form({})
    expect(html).toMatch(/<textarea[^>]*maxLength="1000"/i)
    expect(html).toContain('11 / 1000')
    expect(html).toContain(cs.description.waitWarn)
  })

  it('busy: Uložit disabled with aria-busy', () => {
    expect(form({ busy: true })).toMatch(
      /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>Ukládám…</,
    )
  })

  it('an error is an alert, the typed text stays', () => {
    const html = form({ error: 'Popis je stejný jako teď.' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('>Umýt i kola</textarea>')
  })
})

describe('sheetStart (the sheet prefill)', () => {
  it('a waiting change: its text, not the text in force', () => {
    expect(sheetStart('Starý', change)).toBe(change.description)
  })
  it('a waiting removal: empty', () => {
    expect(sheetStart('Starý', { description: null })).toBe('')
  })
  it('no change: the text in force, or empty', () => {
    expect(sheetStart('Starý', null)).toBe('Starý')
    expect(sheetStart(null, null)).toBe('')
  })
})
