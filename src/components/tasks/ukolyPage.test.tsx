import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ALL_FEATURES } from '~/lib/features'
import { cs } from '~/lib/strings'
import { marker, withMarker } from '~/lib/liveSubs.testing'
import { listTasksFn } from '~/server/tasks/functions'
import type { TaskView } from '~/server/tasks/functions'
import { listTemplatesFn } from '~/server/templates/functions'
import type { TemplateView } from '~/server/templates/functions'

// The Úkoly loader's live subscriptions, in call order (#299).
const LIVE = ['listTasksFn']

// Úkoly itself (#41), rendered statically through its route: one-time tasks grouped by state.
// Lives here, not in src/routes, because the router generator treats every file there as a route.
const page = vi.hoisted(() => ({ data: {}, approveAnywhere: true, openRows: false }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({
      user: { id: 2, role: 'giver', displayName: 'Táta' },
      features: {
        ...ALL_FEATURES,
        approveAnywhere: page.approveAnywhere,
        openRows: page.openRows,
      },
    }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/ukoly' } }),
  // With params (a row's page, #205) the href is built, so a test can see where a row goes.
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to?: string
    params?: Record<string, string>
    children: ReactNode
    className?: string
  }) =>
    params && to ? (
      <a href={to.replace(/\$(\w+)/g, (_, k: string) => params[k] ?? '')} className={className}>
        {children}
      </a>
    ) : (
      <a>{children}</a>
    ),
}))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))
vi.mock('~/server/tasks/functions', () => ({
  completeTaskFn: vi.fn(),
  listTasksFn: vi.fn(),
  releaseTaskFn: vi.fn(),
}))
vi.mock('~/server/templates/functions', () => ({ listTemplatesFn: vi.fn() }))

const { Route } = await import('~/routes/_app/ukoly/index')

describe('Úkoly loader (#299)', () => {
  it('returns the tasks, the chores and the live subscriptions in call order', async () => {
    vi.mocked(listTasksFn).mockResolvedValueOnce(withMarker('listTasksFn', []))
    vi.mocked(listTemplatesFn).mockResolvedValueOnce([])
    const loader = (Route as unknown as { loader: () => Promise<unknown> }).loader
    expect(await loader()).toEqual({ list: [], templates: [], live: LIVE.map(marker) })
  })
})

const boys = [
  { id: 3, name: 'Starší' },
  { id: 4, name: 'Mladší' },
]
const task = (id: number, title: string, over: Partial<TaskView>): TaskView => ({
  planDay: null,
  id,
  title,
  description: null,
  status: 'open',
  score: 5,
  approvalRequired: true,
  createdByName: 'Táta',
  offeredByName: 'Táta',
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
  scoreChange: null,
  rebidding: null,
  ...over,
})

function render(list: TaskView[], templates: TemplateView[] = []) {
  page.data = { list, templates }
  const Page = (Route as unknown as { component: () => ReactNode }).component
  return renderToStaticMarkup(<Page />)
}

describe('Úkoly grouped by state (#41)', () => {
  const all = [
    task(6, 'Zrušený', { status: 'cancelled' }),
    task(5, 'Hotový', { status: 'confirmed', completedBy: boys[0] ?? null }),
    task(4, 'Čekající', { status: 'done_unconfirmed', completedBy: boys[1] ?? null }),
    task(3, 'Rezervovaný', { status: 'reserved', reservedBy: boys[0] ?? null }),
    task(2, 'Volný', { status: 'open' }),
    task(1, 'Uklidit sklep', { status: 'proposed', waitingFor: boys }),
  ]

  it('lists the groups active first, finished last, each with its count', () => {
    const html = render(all)
    const labels = [
      'Návrhy a vyjednávání (1)',
      'Volné (1)',
      'Rezervováno (1)',
      'Čeká na potvrzení (1)',
      'Hotovo (1)',
      'Zrušeno (1)',
    ]
    const at = labels.map((l) => html.indexOf(l))
    expect(
      at.every((i) => i > -1),
      labels.join(' / '),
    ).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    // Each group is a region named by its label.
    expect(html).toContain('<section class="grid gap-2" aria-labelledby="group-reserved">')
    expect(html).toMatch(/<h2[^>]*id="group-reserved"[^>]*>Rezervováno/)
  })

  it('keeps each row’s action and says who an offer waits for', () => {
    const html = render(all)
    expect(html).toContain(cs.work.release)
    expect(html).toContain(cs.work.doneSelf)
    expect(html).toContain(cs.bids.open)
    expect(html).toContain('Čeká se na: Starší nebo Mladší')
  })

  it('with reopenBidding on a free task’s name links to its page, others do not (#212)', () => {
    const html = render(all)
    expect(html).toContain('underline-offset-4">Volný</a>')
    expect(html).not.toContain('underline-offset-4">Rezervovaný</a>')
    expect(html).not.toContain('underline-offset-4">Hotový</a>')
  })

  it('a free chore copy stays unlinked; a round with bids gets Odpovědět, not Hotovo bez bodů', () => {
    const chore = task(7, 'Vynést koš', { status: 'open', origin: 'on_demand', templateId: 1 })
    expect(render([chore])).not.toContain('underline-offset-4">Vynést koš</a>')
    const bid = { takerId: 4, name: 'Mladší', score: 15 }
    const round = task(8, 'Vynést věci na půdu', {
      status: 'open',
      bids: [bid],
      rebidding: { offer: 12, offeredBy: null },
    })
    const html = render([round])
    expect(html).toContain(`>${cs.bids.answer}</a>`)
    expect(html).not.toContain(cs.work.doneSelf)
    // No bids yet: the parent can still close it, and reaches the round through the name.
    expect(render([{ ...round, bids: [] }])).toContain(cs.work.doneSelf)
  })

  it('Hotovo bez bodů is an icon button with its name, no visible label (#176, #180, #194)', () => {
    const html = render(all)
    const button = /<button[^>]*aria-label="Hotovo bez bodů"[^>]*>[\s\S]*?<\/button>/.exec(
      html,
    )?.[0]
    expect(button).toBeDefined()
    expect(button).toMatch(/class="[^"]*size-tap/)
    expect(button).toContain('title="Hotovo bez bodů"')
    expect(button?.replace(/<[^>]+>/g, '')).toBe('')
    // The reserved row keeps its labelled Uvolnit.
    expect(html).toContain(`>${cs.work.release}</button>`)
  })

  it('switch on: Čeká na potvrzení rows get ✓ Schválit and ✕ Zamítnout; other rows keep theirs (#206)', () => {
    page.approveAnywhere = true
    const html = render(all)
    expect(html.match(new RegExp(`aria-label="${cs.work.approve}"`, 'g'))).toHaveLength(1)
    expect(html.match(new RegExp(`aria-label="${cs.work.reject}"`, 'g'))).toHaveLength(1)
    expect(html).toContain(`${cs.work.doneBy} Mladší`)
    expect(html).toContain(cs.work.release)
    expect(html).toContain(cs.work.doneSelf)
  })

  it('switch off: no Schválit on Úkoly, as before', () => {
    page.approveAnywhere = false
    const html = render(all)
    expect(html).not.toContain(`aria-label="${cs.work.approve}"`)
    expect(html).toContain(`${cs.work.doneBy} Mladší`)
    page.approveAnywhere = true
  })

  it('shows the empty line when there are no tasks', () => {
    expect(render([])).toContain(cs.tasks.empty)
  })
})

describe('switch openRows (#205): Úkoly rows open their page', () => {
  const chore: TemplateView = {
    id: 9,
    title: 'Vyndat myčku',
    description: null,
    status: 'active',
    score: 3,
    approvalRequired: true,
    createdByName: 'Táta',
    approvedBy: [],
    schedule: null,
    deadline: null,
    change: null,
    bidding: null,
    lastBids: [],
  }
  const list = [
    task(4, 'Čekající', { status: 'done_unconfirmed', completedBy: boys[1] ?? null }),
    task(3, 'Rezervovaný', { status: 'reserved', reservedBy: boys[0] ?? null }),
    task(2, 'Volný', { status: 'open' }),
    task(1, 'Uklidit sklep', { status: 'proposed', waitingFor: boys }),
  ]
  const linked = (html: string, href: string, name: string) => {
    expect(html, name).toMatch(
      new RegExp(`<a href="${href}" class="[^"]*after:inset-0[^"]*">${name}</a>`),
    )
  }

  it('switch on: every group’s row and each chore, also Čeká na potvrzení with ✓ / ✕', () => {
    page.openRows = true
    for (const approve of [true, false]) {
      page.approveAnywhere = approve
      const html = render(list, [chore])
      for (const t of list) linked(html, `/ukol/${String(t.id)}`, t.title)
      linked(html, '/sablona/9', 'Vyndat myčku')
    }
    page.approveAnywhere = true
    page.openRows = false
  })

  it('switch off: no row is a link', () => {
    expect(render(list, [chore])).not.toContain('after:inset-0')
  })
})
