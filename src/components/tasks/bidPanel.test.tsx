import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { TaskView } from '~/server/tasks/functions'
import { BidPanel } from './BidPanel'
import { BidsToAnswer } from './BidsToAnswer'
import { WaitingForYou } from './WaitingForYou'

// What the bidding screens show (#34), rendered statically. The router, the action hook and the
// server functions don't run in a static render, so they are stubbed as tasks.test.tsx does.
const action = vi.hoisted(() => ({ busy: null as string | null }))
vi.mock('./useTaskAction', () => ({
  useTaskAction: () => ({ busy: action.busy, run: vi.fn() }),
}))
vi.mock('./bidCalls', () => ({ callBid: vi.fn(), BID_CALLS: {} }))
vi.mock('~/server/tasks/functions', () => ({}))
vi.mock('~/server/templates/functions', () => ({}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string
    params?: { taskId: string }
    children: ReactNode
    className?: string
  }) => (
    <a href={params ? to.replace('$taskId', params.taskId) : to} className={className}>
      {children}
    </a>
  ),
}))

const STARSI = { id: 3, role: 'taker' } as const
const TATA = { id: 2, role: 'giver' } as const
const view = (over: Partial<TaskView>): TaskView => ({
  id: 1,
  title: 'Umýt auto',
  status: 'proposed',
  score: 18,
  approvalRequired: true,
  createdByName: 'Táta',
  offeredByName: 'Táta',
  approvedBy: ['Táta'],
  approverIds: [2],
  bids: [],
  lowest: null,
  reservedBy: null,
  completedBy: null,
  completedAt: null,
  earnerId: null,
  waitingFor: [],
  ...over,
})
const bids = view({
  bids: [
    { takerId: 4, name: 'Mladší', score: 22 },
    { takerId: 3, name: 'Starší', score: 25 },
  ],
  lowest: { score: 22, bidders: [{ id: 4, name: 'Mladší' }] },
})
const buttons = (html: string) => html.match(/<button/g)?.length ?? 0

describe('BidPanel', () => {
  it('a brother with a bid: "Beru" before "Souhlasím", both hints, his bid, and he can change it', () => {
    action.busy = null
    const html = renderToStaticMarkup(<BidPanel task={bids} me={STARSI} />)
    expect(html).toMatch(/Beru za 18.*Úkol bude tvůj\..*Souhlasím.*Úkol bude volný pro všechny\./s)
    expect(html).toContain('Tvoje nabídka 25')
    expect(html).toMatch(/Chci jinou cenu.*Nabídnout/s)
  })
  it('a parent: accept the lowest bid, and a new offer', () => {
    action.busy = null
    const html = renderToStaticMarkup(<BidPanel task={bids} me={TATA} />)
    expect(html).toContain('Přijmout 22 (Mladší)')
    expect(html).toContain('Nová nabídka')
  })
  it('a reserved task: no button at all', () => {
    action.busy = null
    const html = renderToStaticMarkup(<BidPanel task={view({ status: 'reserved' })} me={STARSI} />)
    expect(buttons(html)).toBe(0)
  })
  it('busy on "Beru": that button says so, and every button is disabled', () => {
    action.busy = 'take'
    const html = renderToStaticMarkup(<BidPanel task={bids} me={STARSI} />)
    expect(html).toMatch(/<button[^>]*aria-busy="true"[^>]*>Ukládám…/)
    // Every action button; the stepper's − / + only move the number and stay usable.
    const all = (html.match(/<button[^>]*>/g) ?? []).filter((b) => !b.includes('aria-label='))
    expect(all).toHaveLength(3)
    expect(all.every((b) => b.includes('disabled=""'))).toBe(true)
    action.busy = null
  })
})

describe('WaitingForYou with bids', () => {
  it('no bid of mine: "Souhlasím" and "Jiná cena" to the page; with my bid: only "Otevřít"', () => {
    const mine = { ...bids, id: 2 }
    const html = renderToStaticMarkup(<WaitingForYou items={[view({}), mine]} me={STARSI} />)
    const [first = '', second = ''] = html.split('<li').slice(1)
    expect(first).toContain('Souhlasím')
    expect(first).toMatch(/<a href="\/ukol\/1"[^>]*>Jiná cena/)
    expect(second).not.toContain('Souhlasím')
    expect(second).toMatch(/<a href="\/ukol\/2"[^>]*>Otevřít/)
    expect(second).toContain('Táta 18 · ty 25')
  })
})

describe('BidsToAnswer', () => {
  it('lists bids for a parent with the lowest bid and "Odpovědět"; nothing when empty', () => {
    const html = renderToStaticMarkup(<BidsToAnswer items={[bids]} />)
    expect(html).toContain('Vyjednávání (1)')
    expect(html).toContain('Mladší chce 22')
    expect(html).toMatch(/<a href="\/ukol\/1"[^>]*>Odpovědět/)
    expect(renderToStaticMarkup(<BidsToAnswer items={[]} />)).toBe('')
  })
})
