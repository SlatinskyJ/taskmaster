import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
// Launch switches (src/lib/features.ts): all on unless a test turns one off.
const features = vi.hoisted(() => ({ recurring: true, log: true, week: true, meeting: true }))
vi.mock('~/lib/features', () => ({ FEATURES: features }))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))
vi.mock('./bidCalls', () => ({ callBid: vi.fn(), BID_CALLS: {} }))
// The loader's server calls, each returning a marker so the test can see where it went.
vi.mock('~/server/tasks/functions', () => ({
  listPendingApprovalsFn: vi.fn(() => Promise.resolve(['waiting'])),
  listBoardFn: vi.fn(() => Promise.resolve(['board'])),
  listPendingCompletionsFn: vi.fn(() => Promise.resolve(['toApprove'])),
  listBidsToAnswerFn: vi.fn(() => Promise.resolve(['bids'])),
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

function render(user: PageUser, recurring: TemplateView[]) {
  page.user = user
  page.data = {
    waiting: [],
    waitingTemplates: [],
    priceChanges: [dishes],
    board: [],
    recurring,
    toApprove: [],
    bids: [],
  }
  const Page = (Route as unknown as { component: () => ReactNode }).component
  return renderToStaticMarkup(<Page />)
}

describe('Domů', () => {
  beforeEach(() => {
    features.recurring = true
  })

  it('launch: with recurring off a brother sees no chores, no price changes', () => {
    features.recurring = false
    const html = render({ id: 4, role: 'taker', displayName: 'Starší' }, [dishes, flowers])
    expect(html).not.toContain('Opakované úkoly')
    expect(html).not.toContain('Zalít kytky')
    expect(html).not.toContain('Táta nabízí 4')
  })

  it('launch: with recurring off a parent sees no price changes either', () => {
    features.recurring = false
    const html = render({ id: 2, role: 'giver', displayName: 'Táta' }, [])
    expect(html).not.toContain('Mladší chce 5')
  })

  it('a parent with nothing to answer gets one line and the way to Nový úkol', () => {
    page.user = { id: 2, role: 'giver', displayName: 'Táta' }
    page.data = {
      waiting: [],
      waitingTemplates: [],
      priceChanges: [],
      board: [],
      recurring: [],
      toApprove: [],
      bids: [],
    }
    const Page = (Route as unknown as { component: () => ReactNode }).component
    const html = renderToStaticMarkup(<Page />)
    expect(html).toContain('Teď na tebe nic nečeká.')
    expect(html).toContain('Nový úkol')
  })

  it('a parent with only a hidden price change still gets the empty line at launch', () => {
    features.recurring = false
    expect(render({ id: 2, role: 'giver', displayName: 'Táta' }, [])).toContain(
      'Teď na tebe nic nečeká.',
    )
  })

  it('a parent with a price change waiting gets no empty line', () => {
    expect(render({ id: 2, role: 'giver', displayName: 'Táta' }, [])).not.toContain(
      'Teď na tebe nic nečeká.',
    )
  })

  it('a brother never gets the parent empty line', () => {
    page.user = { id: 4, role: 'taker', displayName: 'Starší' }
    page.data = {
      waiting: [],
      waitingTemplates: [],
      priceChanges: [],
      board: [],
      recurring: [],
      toApprove: [],
      bids: [],
    }
    const Page = (Route as unknown as { component: () => ReactNode }).component
    expect(renderToStaticMarkup(<Page />)).not.toContain('Teď na tebe nic nečeká.')
  })

  it('has no "Tady brzy něco bude" line', () => {
    const html = render({ id: 4, role: 'taker', displayName: 'Starší' }, [])
    expect(html).not.toContain('Tady brzy něco bude')
  })

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
    })
  })

  it('a parent gets the price changes, no recurring list', async () => {
    expect(await load('giver')).toEqual({
      waiting: ['waiting'],
      waitingTemplates: ['waitingTemplates'],
      priceChanges: ['priceChanges'],
      board: [],
      recurring: [],
      toApprove: ['toApprove'],
      bids: ['bids'],
    })
  })
})
