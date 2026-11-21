import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { TemplateView } from '~/server/templates/functions'

// Domů itself (#138), rendered statically through its route, so the wiring of the price change
// rows and a brother's "Opakované úkoly" is tested, not only the components. Lives here, not in
// src/routes, because the router generator treats every file there as a route.
interface PageUser {
  id: number
  role: 'taker' | 'giver'
  displayName: string
}
const page = vi.hoisted(() => {
  const state: { user: PageUser | null; data: Record<string, unknown> } = { user: null, data: {} }
  return state
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: page.user }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))
vi.mock('./bidCalls', () => ({ callBid: vi.fn(), BID_CALLS: {} }))
// The loader's server calls, each returning a marker so the test can see where it went.
vi.mock('~/server/tasks/functions', () => ({
  listPendingApprovalsFn: vi.fn(() => Promise.resolve(['waiting'])),
  listBoardFn: vi.fn(() => Promise.resolve(['board'])),
  listPendingCompletionsFn: vi.fn(() => Promise.resolve(['toApprove'])),
  listBidsToAnswerFn: vi.fn(() => Promise.resolve(['bids'])),
  listTasksFn: vi.fn(() => Promise.resolve(['tasks'])),
}))
const points = vi.hoisted(() => ({
  value: {
    levels: { lower: 40, upper: 90 },
    takers: [{ id: 4, name: 'Starší', confirmed: 18, pending: 5 }] as {
      id: number
      name: string
      confirmed: number
      pending: number
    }[],
  },
}))
vi.mock('~/server/points/functions', () => ({
  getPointsFn: vi.fn(() => Promise.resolve(['points'])),
}))
vi.mock('~/server/templates/functions', () => ({
  listPendingTemplateApprovalsFn: vi.fn(() => Promise.resolve(['waitingTemplates'])),
  listPendingTemplatePriceChangesFn: vi.fn(() => Promise.resolve(['priceChanges'])),
  listTemplatesFn: vi.fn(() => Promise.resolve(['recurring'])),
}))

const { Route } = await import('~/routes/_app/index')

const dishes: TemplateView = {
  id: 9,
  title: 'Vyndat myčku',
  status: 'active',
  score: 3,
  approvalRequired: true,
  createdByName: 'Táta',
  approvedBy: [],
  schedule: null,
  deadline: null,
  change: {
    offer: { score: 4, byName: 'Táta' },
    bids: [{ takerId: 5, name: 'Mladší', score: 5 }],
    lowest: 5,
  },
}

const flowers: TemplateView = { ...dishes, id: 10, title: 'Zalít kytky', change: null }

function render(user: PageUser, recurring: TemplateView[], over: Record<string, unknown> = {}) {
  page.user = user
  page.data = {
    waiting: [],
    waitingTemplates: [],
    priceChanges: [dishes],
    board: [],
    recurring,
    toApprove: [],
    bids: [],
    tasks: [],
    points: points.value,
    ...over,
  }
  const Page = (Route as unknown as { component: () => ReactNode }).component
  return renderToStaticMarkup(<Page />)
}

describe('Domů', () => {
  it('a brother sees the parents’ offer waiting and his recurring chores with Jiná cena', () => {
    const html = render({ id: 4, role: 'taker', displayName: 'Starší' }, [dishes, flowers])
    expect(html).toContain('Táta nabízí 4')
    expect(html).toContain('Opakované úkoly')
    expect(html).toContain('Zalít kytky')
    expect(html).toContain('Jiná cena')
  })

  it('a chore already waiting on the brother is not listed again under Opakované úkoly', () => {
    const html = render({ id: 4, role: 'taker', displayName: 'Starší' }, [dishes])
    expect(html).toContain('Táta nabízí 4')
    expect(html).not.toContain('Opakované úkoly')
  })

  it('a parent sees the bid to answer and no recurring list', () => {
    const html = render({ id: 2, role: 'giver', displayName: 'Táta' }, [])
    expect(html).toContain('Mladší chce 5')
    expect(html).not.toContain('Opakované úkoly')
  })
})

describe('Domů points (#40)', () => {
  const starsi = { id: 4, role: 'taker', displayName: 'Starší' } as const

  it('a brother sees his points card above Čeká na tebe, against the given levels', () => {
    const html = render(starsi, [])
    expect(html).toContain('data-slot="points-bar"')
    expect(html).toContain('18 ✔')
    expect(html).toContain('5 ⏳')
    expect(html).toContain('spodní 40')
    expect(html).toContain('horní 90')
    expect(html.indexOf('data-slot="points-bar"')).toBeLessThan(html.indexOf(cs.home.waiting))
  })

  it('a brother with no points sees zeros', () => {
    const before = points.value
    points.value = { ...before, takers: [{ id: 4, name: 'Starší', confirmed: 0, pending: 0 }] }
    const html = render(starsi, [])
    points.value = before
    expect(html).toContain('0 ✔')
    expect(html).toContain('0 ⏳')
  })

  it('a parent’s Domů has no brother’s own points card, only the boys’ overview (#41)', () => {
    const html = render({ id: 2, role: 'giver', displayName: 'Táta' }, [])
    expect(html).not.toContain(cs.points.missingLower(22))
    expect(html).toContain(cs.points.takersTitle)
  })
})

describe('Domů loader', () => {
  type Loader = (args: { context: { user: { role: string } } }) => Promise<Record<string, unknown>>
  const load = (role: string) =>
    (Route as unknown as { loader: Loader }).loader({ context: { user: { role } } })

  it('a brother gets the price changes and the recurring chores', async () => {
    expect(await load('taker')).toEqual({
      waiting: ['waiting'],
      waitingTemplates: ['waitingTemplates'],
      priceChanges: ['priceChanges'],
      board: ['board'],
      recurring: ['recurring'],
      toApprove: [],
      bids: [],
      tasks: [],
      points: ['points'],
    })
  })

  it('a parent gets the price changes, every taker’s points and the task list, no recurring list', async () => {
    expect(await load('giver')).toEqual({
      waiting: ['waiting'],
      waitingTemplates: ['waitingTemplates'],
      priceChanges: ['priceChanges'],
      board: [],
      recurring: [],
      toApprove: ['toApprove'],
      bids: ['bids'],
      tasks: ['tasks'],
      points: ['points'],
    })
  })
})

describe('Giver Domů (GHome, #41)', () => {
  const tata = { id: 2, role: 'giver', displayName: 'Táta' } as const
  const boys = [
    { id: 4, name: 'Starší' },
    { id: 5, name: 'Mladší' },
  ]
  const task = (over: Record<string, unknown>) => ({
    id: 1,
    title: 'Úkol',
    status: 'proposed',
    score: 10,
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
  const full = {
    waiting: [task({ id: 1, title: 'Čeká na Tátu', waitingFor: [{ id: 2, name: 'Táta' }] })],
    toApprove: [task({ id: 2, title: 'Hotový úkol', status: 'done_unconfirmed', earnerId: 4 })],
    bids: [
      task({
        id: 3,
        title: 'S nabídkou',
        bids: [{ takerId: 5, name: 'Mladší', score: 22 }],
        lowest: { score: 22, bidders: [{ id: 5, name: 'Mladší' }] },
      }),
    ],
    tasks: [task({ id: 4, title: 'Uklidit sklep', waitingFor: boys })],
    points: {
      levels: { lower: 50, upper: 100 },
      takers: [
        { id: 4, name: 'Starší', confirmed: 40, pending: 12 },
        { id: 5, name: 'Mladší', confirmed: 55, pending: 0 },
      ],
    },
  }

  it('shows, in order: Čeká na tebe, the boys’ points, Ke schválení, Vyjednávání, Čeká na kluky', () => {
    const html = render(tata, [], full)
    const at = (s: string) => html.indexOf(s)
    for (const s of [
      cs.home.waiting,
      'Kluci tento týden',
      cs.work.toApprove,
      cs.bids.toAnswer,
      'Čeká na kluky',
    ])
      expect(at(s), s).toBeGreaterThan(-1)
    expect(at(cs.home.waiting)).toBeLessThan(at('Kluci tento týden'))
    expect(at('Kluci tento týden')).toBeLessThan(at(cs.work.toApprove))
    expect(at(cs.work.toApprove)).toBeLessThan(at(cs.bids.toAnswer))
    expect(at(cs.bids.toAnswer)).toBeLessThan(at('Čeká na kluky'))
    expect(html).toContain('Čeká se na: Starší nebo Mladší')
    expect(html.split('data-slot="points-bar"')).toHaveLength(3)
  })

  it('a parent never gets a brother’s own points card, even with points loaded', () => {
    // A row with the parent's own id: only the role check keeps MyPoints off his Domů.
    const mine = { id: 2, name: 'Táta', confirmed: 10, pending: 0 }
    const html = render(tata, [], { ...full, points: { ...full.points, takers: [mine] } })
    expect(html).not.toContain('Do spodní hranice chybí')
    expect(html.split('data-slot="points-bar"')).toHaveLength(2)
  })

  it('a brother sees neither the boys’ card nor Čeká na kluky, only his own bar', () => {
    const html = render({ id: 4, role: 'taker', displayName: 'Starší' }, [], {
      points: full.points,
      tasks: full.tasks,
    })
    expect(html).not.toContain('Kluci tento týden')
    expect(html).not.toContain('Čeká na kluky')
    expect(html.split('data-slot="points-bar"')).toHaveLength(2)
  })
})
