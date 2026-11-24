import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ALL_FEATURES } from '~/lib/features'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'

// Úkoly itself (#41), rendered statically through its route: one-time tasks grouped by state.
// Lives here, not in src/routes, because the router generator treats every file there as a route.
const page = vi.hoisted(() => ({ data: {} }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({
      user: { id: 2, role: 'giver', displayName: 'Táta' },
      features: ALL_FEATURES,
    }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/ukoly' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))
vi.mock('~/server/tasks/functions', () => ({
  completeTaskFn: vi.fn(),
  listTasksFn: vi.fn(),
  releaseTaskFn: vi.fn(),
}))
vi.mock('~/server/templates/functions', () => ({ listTemplatesFn: vi.fn() }))

const { Route } = await import('~/routes/_app/ukoly/index')

const boys = [
  { id: 3, name: 'Starší' },
  { id: 4, name: 'Mladší' },
]
const task = (id: number, title: string, over: Partial<TaskView>): TaskView => ({
  id,
  title,
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

function render(list: TaskView[]) {
  page.data = { list, templates: [] }
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
    expect(html).toContain('<a>Volný</a>')
    expect(html).not.toContain('<a>Rezervovaný</a>')
    expect(html).not.toContain('<a>Hotový</a>')
  })

  it('shows the empty line when there are no tasks', () => {
    expect(render([])).toContain(cs.tasks.empty)
  })
})
