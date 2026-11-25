import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { getProposalsFn } from '~/server/periods/functions'
import type { TaskView } from '~/server/tasks/functions'
import { defaultsProposal, periodProposal, proposalsView } from '../proposals/fixtures'
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
    useRouteContext: () => ({ user: page.user, features }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
// Launch switches (the app shell's `context.features`): all on unless a test turns one off.
const features = vi.hoisted(() => ({
  recurring: true,
  log: true,
  week: true,
  meeting: true,
  periodProposals: false,
  approveAnywhere: false,
}))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))
vi.mock('./bidCalls', () => ({ callBid: vi.fn(), BID_CALLS: {} }))
// The loader's server calls, each returning a marker so the test can see where it went.
vi.mock('~/server/tasks/functions', () => ({
  listPendingApprovalsFn: vi.fn(() => Promise.resolve(['waiting'])),
  listBoardFn: vi.fn(() => Promise.resolve(['board'])),
  listPendingCompletionsFn: vi.fn(() => Promise.resolve(['toApprove'])),
  listBidsToAnswerFn: vi.fn(() => Promise.resolve(['bids'])),
  listScoreChangesWaitingFn: vi.fn(() => Promise.resolve(['taskPriceChanges'])),
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
vi.mock('~/server/periods/functions', () => ({
  getProposalsFn: vi.fn(() => Promise.resolve('proposals')),
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
  bidding: null,
  lastBids: [],
  change: {
    offer: { score: 4, byName: 'Táta' },
    bids: [{ takerId: 5, name: 'Mladší', score: 5 }],
    lowest: 5,
  },
}

const flowers: TemplateView = { ...dishes, id: 10, title: 'Zalít kytky', change: null }
/** A proposed chore with first-price bidding (#209): Táta offers 10, Starší bids 12. */
const bins = (bids: { takerId: number; name: string; score: number }[]): TemplateView => ({
  ...dishes,
  id: 11,
  title: 'Vynést koš',
  status: 'proposed',
  score: 10,
  change: null,
  bidding: {
    offer: { score: 10, byName: 'Táta' },
    bids,
    lowest: bids[0]?.score ?? null,
    lastBids: bids.map((b) => ({ takerId: b.takerId, score: b.score })),
  },
})

function render(user: PageUser, recurring: TemplateView[], over: Record<string, unknown> = {}) {
  page.user = user
  page.data = {
    waiting: [],
    waitingTemplates: [],
    priceChanges: [dishes],
    taskPriceChanges: [],
    board: [],
    recurring,
    toApprove: [],
    bids: [],
    tasks: [],
    points: points.value,
    proposals: null,
    ...over,
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
    const html = render({ id: 2, role: 'giver', displayName: 'Táta' }, [], { priceChanges: [] })
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

  it('a parent with only a task price change waiting gets no empty line', () => {
    // Mamka's new price on a one-time task waits for Táta; it is not behind any launch switch.
    features.recurring = false
    const change: TaskView = {
      id: 7,
      title: 'Vyluxovat celý obývák a chodbu',
      status: 'open',
      score: 10,
      approvalRequired: true,
      createdByName: 'Táta',
      offeredByName: null,
      approvedBy: [],
      approverIds: [],
      bids: [],
      lowest: null,
      lastBids: [],
      reservedBy: null,
      completedBy: null,
      completedAt: null,
      earnerId: null,
      origin: 'one_time',
      templateId: null,
      dueAt: null,
      graceEndsAt: null,
      createdAt: '2026-11-17T10:00:00.000Z',
      waitingFor: [],
      rebidding: null,
      scoreChange: {
        id: 3,
        score: 12,
        proposedBy: { id: 5, name: 'Mamka' },
        approvedBy: [{ id: 5, name: 'Mamka' }],
        waitingFor: [{ id: 2, name: 'Táta' }],
      },
    }
    const html = render({ id: 2, role: 'giver', displayName: 'Táta' }, [], {
      taskPriceChanges: [change],
    })
    expect(html).toContain('Vyluxovat celý obývák a chodbu')
    expect(html).not.toContain('Teď na tebe nic nečeká.')
  })

  it('a parent with two kinds of item waiting gets no empty line', () => {
    // One template approval and one price change: the counts add up, they don't cancel out.
    const html = render({ id: 2, role: 'giver', displayName: 'Táta' }, [], {
      waitingTemplates: [flowers],
    })
    expect(html).not.toContain('Teď na tebe nic nečeká.')
  })

  it("a brother's proposed chore row follows first-price bidding (#209)", () => {
    const mladsi = { id: 5, role: 'taker', displayName: 'Mladší' } as const
    const starsi = { id: 4, role: 'taker', displayName: 'Starší' } as const
    const bid = [{ takerId: 4, name: 'Starší', score: 12 }]
    const without = render(mladsi, [], { priceChanges: [], waitingTemplates: [bins([])] })
    expect(without).toContain('Souhlasím')
    expect(without).toContain('Jiná cena')
    expect(without).toContain('Táta nabízí 10')
    const mine = render(starsi, [], { priceChanges: [], waitingTemplates: [bins(bid)] })
    expect(mine).toContain('Otevřít')
    expect(mine).not.toContain('Souhlasím')
    const off = render(mladsi, [], {
      priceChanges: [],
      waitingTemplates: [{ ...bins(bid), bidding: null }],
    })
    expect(off).toContain('Souhlasím')
    expect(off).not.toContain('Jiná cena')
    expect(off).toContain('Opakovaný')
  })

  it('a brother never gets the parent empty line', () => {
    const html = render({ id: 4, role: 'taker', displayName: 'Starší' }, [], { priceChanges: [] })
    expect(html).not.toContain('Teď na tebe nic nečeká.')
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
  type Loader = (args: {
    context: { user: { role: string }; features: { periodProposals: boolean } }
  }) => Promise<Record<string, unknown>>
  const load = (role: string, periodProposals = false) =>
    (Route as unknown as { loader: Loader }).loader({
      context: { user: { role }, features: { periodProposals } },
    })
  beforeEach(() => {
    vi.mocked(getProposalsFn).mockClear()
  })

  it('switch off: no proposals call; on: one call, for brothers and parents', async () => {
    expect((await load('taker')).proposals).toBeNull()
    expect((await load('giver')).proposals).toBeNull()
    expect(getProposalsFn).not.toHaveBeenCalled()
    expect((await load('taker', true)).proposals).toBe('proposals')
    expect(getProposalsFn).toHaveBeenCalledTimes(1)
    expect((await load('giver', true)).proposals).toBe('proposals')
    expect(getProposalsFn).toHaveBeenCalledTimes(2)
  })

  it('a brother gets the price changes and the recurring chores', async () => {
    expect(await load('taker')).toEqual({
      waiting: ['waiting'],
      waitingTemplates: ['waitingTemplates'],
      priceChanges: ['priceChanges'],
      taskPriceChanges: ['taskPriceChanges'],
      proposals: null,
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
      taskPriceChanges: ['taskPriceChanges'],
      proposals: null,
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
    lastBids: [],
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
        lastBids: [],
      }),
    ],
    tasks: [
      task({ id: 4, title: 'Uklidit sklep', waitingFor: boys }),
      // Waits for Táta himself: "Čeká na tebe" has it, so "Čeká na kluky" must not.
      task({ id: 5, title: 'Taky pro Tátu', waitingFor: [...boys, { id: 2, name: 'Táta' }] }),
    ],
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
    expect(html).toContain(`${cs.home.waitingOnTakers} (1)`)
    expect(html).not.toContain('Taky pro Tátu')
    expect(html.split('data-slot="points-bar"')).toHaveLength(3)
  })

  describe('switch approveAnywhere on (#206)', () => {
    beforeEach(() => {
      features.approveAnywhere = true
    })
    afterEach(() => {
      features.approveAnywhere = false
    })

    it('Ke schválení comes first, once, then Čeká na tebe, the boys’ points, Vyjednávání, Čeká na kluky', () => {
      const html = render(tata, [], full)
      const at = (s: string) => html.indexOf(s)
      const order = [
        cs.work.toApprove,
        cs.home.waiting,
        'Kluci tento týden',
        cs.bids.toAnswer,
        'Čeká na kluky',
      ]
      for (const s of order) expect(at(s), s).toBeGreaterThan(-1)
      for (let i = 1; i < order.length; i++)
        expect(at(order[i - 1] ?? ''), order[i]).toBeLessThan(at(order[i] ?? ''))
      expect(html.split(`${cs.work.toApprove} (`)).toHaveLength(2)
    })

    it('nothing to approve: no Ke schválení at all', () => {
      const html = render(tata, [], { ...full, toApprove: [] })
      expect(html).not.toContain(cs.work.toApprove)
    })

    it('a brother never gets Ke schválení', () => {
      const html = render({ id: 4, role: 'taker', displayName: 'Starší' }, [], full)
      expect(html).not.toContain(cs.work.toApprove)
    })
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

describe('Domů proposal rows (#43)', () => {
  const mladsi = { id: 4, role: 'taker', displayName: 'Mladší' } as const
  const view = proposalsView({ period: periodProposal() })
  afterEach(() => {
    features.periodProposals = false
  })

  it('switch on: a row for the proposal waiting for me, counted, with Otevřít', () => {
    features.periodProposals = true
    const html = render(mladsi, [], { priceChanges: [], proposals: view })
    expect(html).toContain(cs.proposals.entry.periodRow)
    expect(html).toContain(`${cs.home.waiting} (1)`)
    expect(html).toContain(cs.proposals.entry.open)
  })

  it('a default-week proposal waiting for me has its own row', () => {
    features.periodProposals = true
    const html = render(mladsi, [], {
      priceChanges: [],
      proposals: proposalsView({ defaults: defaultsProposal() }),
    })
    expect(html).toContain(cs.proposals.entry.defaultsRow)
    expect(html).not.toContain(cs.proposals.entry.periodRow)
  })

  it('switch off: no row even with data', () => {
    const html = render(mladsi, [], { priceChanges: [], proposals: view })
    expect(html).not.toContain(cs.proposals.entry.periodRow)
  })

  it('the proposer gets no row for his own proposal', () => {
    features.periodProposals = true
    const html = render({ id: 3, role: 'taker', displayName: 'Starší' }, [], {
      priceChanges: [],
      proposals: view,
    })
    expect(html).not.toContain(cs.proposals.entry.periodRow)
  })

  it('a parent waiting on a proposal is not idle', () => {
    features.periodProposals = true
    const html = render({ id: 2, role: 'giver', displayName: 'Táta' }, [], {
      priceChanges: [],
      proposals: view,
    })
    expect(html).toContain(cs.proposals.entry.periodRow)
    expect(html).not.toContain(cs.home.giverEmpty)
  })
})
