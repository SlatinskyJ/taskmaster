import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/server/disputes/functions', () => ({ openDisputeFn: vi.fn() }))

const { DisputeControl } = await import('./DisputeControl')
const { DisputeForm } = await import('./DisputeForm')
const { DisputeList } = await import('./DisputeList')
const { TaskRow } = await import('~/components/tasks/TaskRow')

const item = { kind: 'completion', id: 10 } as const
const control = (mark: Parameters<typeof DisputeControl>[0]['mark'], lead?: boolean) =>
  renderToStaticMarkup(
    <DisputeControl
      item={item}
      mark={mark}
      what={cs.disputes.what.completion}
      value="Vysát auto · 22 b."
      name="Vysát auto"
      lead={lead}
    />,
  )

describe('DisputeControl', () => {
  it('no dispute: only the button, named with what and the item, 44 px high', () => {
    const html = control(null)
    expect(html).toContain('data-slot="dispute"')
    expect(html).toContain(`>${cs.disputes.action}<`)
    expect(html).toContain('aria-label="Rozporovat: Potvrzené splnění – Vysát auto"')
    expect(html).toMatch(/<button[^>]*class="[^"]*min-h-tap/)
    expect(html).not.toContain(cs.state.disputed)
  })

  it('open: the chip "Sporné · čeká na správce", no button', () => {
    const html = control({ status: 'open' })
    expect(html).toContain(cs.disputes.waiting)
    expect(html).toContain('data-state="disputed"')
    expect(html).not.toContain('<button')
  })

  it('dismissed: the kept outcome with the note, and the button again', () => {
    const html = control({ status: 'dismissed', note: 'Body sedí.' })
    expect(html).toContain('Správce nechal beze změny: Body sedí.')
    expect(html).toContain(`>${cs.disputes.action}<`)
  })

  it('corrected: the fixed outcome with the note', () => {
    const html = control({ status: 'corrected', note: 'Přidáno 5.' })
    expect(html).toContain('Správce opravil: Přidáno 5.')
    expect(html).not.toContain('Správce nechal beze změny')
  })

  it('lead: what is shown as text before the button', () => {
    expect(control(null, true)).toMatch(/Potvrzené splnění<\/span>.*<button/)
    expect(control(null)).not.toMatch(/Potvrzené splnění<\/span>/)
  })
})

describe('DisputeForm (TDispute)', () => {
  const form = (over: Partial<Parameters<typeof DisputeForm>[0]> = {}) =>
    renderToStaticMarkup(
      <DisputeForm
        what="Potvrzené splnění"
        value="Starší · Vysát auto · 22 b."
        reason=""
        busy={false}
        error={null}
        onReason={() => undefined}
        onSend={() => undefined}
        {...over}
      />,
    )

  it('shows what, the value, the reason field, the note and Poslat správci', () => {
    const html = form()
    expect(html).toContain('Potvrzené splnění')
    expect(html).toContain('Starší · Vysát auto · 22 b.')
    expect(html).toContain(cs.disputes.reasonLabel)
    expect(html).toMatch(/<textarea[^>]*maxlength="200"/i)
    expect(html).toContain(cs.disputes.note)
    expect(html).toContain(cs.disputes.send)
  })

  it('Poslat správci is disabled while the reason is empty or blank', () => {
    expect(form()).toMatch(/<button[^>]*\sdisabled=""/)
    expect(form({ reason: '   ' })).toMatch(/<button[^>]*\sdisabled=""/)
    expect(form({ reason: 'Byl i kufr.' })).not.toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('busy: disabled, aria-busy and Posílám…', () => {
    const html = form({ reason: 'x', busy: true })
    expect(html).toMatch(/<button[^>]*aria-busy="true"/)
    expect(html).toContain(cs.disputes.sending)
    expect(html).toMatch(/<button[^>]*\sdisabled=""/)
  })

  it('an error shows under the field and the typed reason stays', () => {
    const html = form({ reason: 'Byl i kufr.', error: 'Už je rozporováno.' })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Už je rozporováno.')
    expect(html).toContain('>Byl i kufr.</textarea>')
  })
})

describe('DisputeList (Rozporováno)', () => {
  const entry = {
    id: 1,
    item,
    title: 'Vysát auto',
    week: null,
    takerName: 'Starší',
    openedByName: 'Táta',
    reason: 'Jen půlka.',
    openedAt: '2026-11-22T12:00:00.000Z',
    mark: { status: 'dismissed', note: 'Body sedí.' },
  } as const

  it('empty: renders nothing', () => {
    expect(renderToStaticMarkup(<DisputeList entries={[]} />)).toBe('')
  })

  it('an entry: what, title, taker, opener and reason, and its outcome', () => {
    const html = renderToStaticMarkup(<DisputeList entries={[entry]} />)
    expect(html).toContain(cs.disputes.list)
    expect(html).toContain('Potvrzené splnění')
    expect(html).toContain('Vysát auto')
    expect(html).toContain('Starší')
    expect(html).toContain('Táta: Jen půlka.')
    expect(html).toContain('Správce nechal beze změny: Body sedí.')
  })

  it('a settlement entry shows its week', () => {
    const html = renderToStaticMarkup(
      <DisputeList
        entries={[
          {
            ...entry,
            item: { kind: 'settlement', id: 3 },
            title: '',
            week: { startsAt: '2026-11-14T19:00:00.000Z', endsAt: '2026-11-21T19:00:00.000Z' },
            mark: { status: 'open' },
          },
        ]}
      />,
    )
    expect(html).toContain('Vyúčtování týdne')
    expect(html).toContain('14. 11. – 21. 11.')
    expect(html).toContain(cs.disputes.waiting)
  })
})

describe('TaskRow footer', () => {
  it('renders inside the row card', () => {
    const html = renderToStaticMarkup(
      <TaskRow name="Vysát auto" state="confirmed" points={22} footer={<i>patička</i>} />,
    )
    expect(html).toMatch(/data-slot="task-row"[^]*<i>patička<\/i>[^]*<\/div>$/)
  })
})
