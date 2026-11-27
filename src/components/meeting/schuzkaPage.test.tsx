import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planFixture } from '~/components/week/fixtures'
import { marker, withMarker } from '~/lib/liveSubs.testing'
import { getWeekPlanFn } from '~/server/instances/functions'
import type { Meeting } from '~/server/settlement/functions'
import { getMeetingFn } from '~/server/settlement/functions'
import { listPlanTasksFn } from '~/server/tasks/functions'
import { cs } from '~/lib/strings'
import { noWeek, pendingWeek, week } from './fixtures'

// Schůzka through its route (#44): the loader's calls and that the page renders the meeting,
// not the old placeholder. Lives here, not in src/routes (the router generator owns that).
// #259: the week plan is fetched only with the switch on, on the settlement's Prague day.
const page = vi.hoisted(() => ({ data: {} }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({
      user: { id: 2, role: 'giver', displayName: 'Táta' },
      features: { periodProposals: false },
    }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn((to: unknown) => ({ redirect: to })),
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/schuzka' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/server/settlement/functions', () => ({
  getMeetingFn: vi.fn(() => Promise.resolve(withMarker('getMeetingFn', 'meeting'))),
  settlePeriodFn: vi.fn(),
}))
vi.mock('~/server/instances/functions', () => ({
  getWeekPlanFn: vi.fn(() => Promise.resolve(withMarker('getWeekPlanFn', 'week'))),
}))
vi.mock('~/server/tasks/functions', () => ({
  listPlanTasksFn: vi.fn(() => Promise.resolve(withMarker('listPlanTasksFn', 'plan'))),
  approveTaskFn: vi.fn(),
  rejectTaskFn: vi.fn(),
  reserveTaskFn: vi.fn(),
  releaseTaskFn: vi.fn(),
}))

const { Route } = await import('~/routes/_app/schuzka')
interface RouteOpts {
  beforeLoad: (a: { context: unknown }) => void
  loader: (a: { context: unknown }) => Promise<unknown>
  component: () => ReactNode
}
const route = Route as unknown as RouteOpts

const load = (weekPlan: boolean) => route.loader({ context: { features: { weekPlan } } })
const meetingIs = (m: Meeting) => {
  vi.mocked(getMeetingFn).mockResolvedValueOnce(withMarker('getMeetingFn', m))
}
const render = (meeting: Meeting, weekPlan: unknown = null) => {
  page.data = { meeting, plan: [], weekPlan }
  return renderToStaticMarkup(<route.component />)
}
const thrown = (f: () => void): unknown => {
  try {
    f()
  } catch (e) {
    return e
  }
  return undefined
}
const stillRunning = (settledToday: boolean) =>
  noWeek({ runningCutoffAt: '2026-12-06T22:59:00.000Z', settledToday })

const TWO = [marker('getMeetingFn'), marker('listPlanTasksFn')]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Schůzka page', () => {
  it('the loader asks for the meeting and the plan tasks', async () => {
    expect(await load(false)).toEqual({
      meeting: 'meeting',
      plan: 'plan',
      weekPlan: null,
      live: [marker('getMeetingFn'), marker('listPlanTasksFn')],
    })
    expect(getMeetingFn).toHaveBeenCalledTimes(1)
    expect(listPlanTasksFn).toHaveBeenCalledTimes(1)
  })

  it('renders the meeting, not the placeholder', () => {
    const html = render(pendingWeek())
    expect(html).toContain('Schůzka')
    expect(html).toContain('Zalít kytky')
    expect(html).toContain('Zbývá schválit: 2')
    expect(html).not.toContain(cs.placeholder.soon)
  })
})

describe('the week plan at Schůzka (#259)', () => {
  it('switch off: meeting and plan tasks only, even settled today', async () => {
    const m = stillRunning(true)
    meetingIs(m)
    expect(await load(false)).toEqual({ meeting: m, plan: 'plan', weekPlan: null, live: TWO })
    expect(getWeekPlanFn).not.toHaveBeenCalled()
  })

  it('switch on, not settled today: no plan request', async () => {
    const m = stillRunning(false)
    meetingIs(m)
    expect(await load(true)).toEqual({ meeting: m, plan: 'plan', weekPlan: null, live: TWO })
    expect(getWeekPlanFn).not.toHaveBeenCalled()
  })

  it('switch on, settled today: the plan is fetched', async () => {
    const m = stillRunning(true)
    meetingIs(m)
    expect(await load(true)).toEqual({
      meeting: m,
      plan: 'plan',
      weekPlan: 'week',
      live: [...TWO, marker('getWeekPlanFn')],
    })
    expect(getWeekPlanFn).toHaveBeenCalledTimes(1)
  })

  it('renders step 3 with the table when settled today', () => {
    const html = render(stillRunning(true), planFixture())
    expect(html).toContain(cs.meeting.notYet)
    expect(html).toContain(cs.meeting.planTasks)
    expect(html).toContain(`>${cs.plan.title}<`)
    expect(html).toContain(cs.meeting.refresh)
    expect(html).toContain('landscape:max-w-3xl')
  })

  it('step 3 on a day without a settlement: unchanged and narrow', () => {
    for (const m of [noWeek(), stillRunning(false)]) {
      const html = render(m, null)
      expect(html).toContain(cs.meeting.planTasks)
      expect(html).not.toContain(`>${cs.plan.title}<`)
      expect(html).not.toContain(cs.meeting.refresh)
      expect(html).not.toContain('landscape:max-w-3xl')
    }
  })

  it('step 1 with a plan loaded: narrow, no table', () => {
    const m = { ...pendingWeek(), settledToday: true }
    const html = render(m, planFixture())
    expect(html).toContain('Zbývá schválit: 2')
    expect(html).not.toContain(`>${cs.plan.title}<`)
    expect(html).not.toContain('landscape:max-w-3xl')
  })

  it('step 2 territory (a period to settle) with a plan loaded: narrow, no table', () => {
    const html = render(week({ settledToday: true }), planFixture())
    expect(html).not.toContain(`>${cs.plan.title}<`)
    expect(html).not.toContain('landscape:max-w-3xl')
  })

  it('feature_off answer: step 3 narrow and unchanged', () => {
    const html = render(stillRunning(true), { error: 'feature_off' })
    expect(html).toContain(cs.meeting.planTasks)
    expect(html).not.toContain(`>${cs.plan.title}<`)
    expect(html).not.toContain(cs.meeting.refresh)
    expect(html).not.toContain('landscape:max-w-3xl')
  })

  it('beforeLoad with the switch on: a taker goes home, the admin to Správa, a giver stays', () => {
    const ctx = (role: string) => ({
      context: { user: { id: 2, role }, features: { weekPlan: true } },
    })
    expect(
      thrown(() => {
        route.beforeLoad(ctx('taker'))
      }),
    ).toEqual({ redirect: { to: '/' } })
    expect(
      thrown(() => {
        route.beforeLoad(ctx('admin'))
      }),
    ).toEqual({ redirect: { to: '/sprava' } })
    expect(
      thrown(() => {
        route.beforeLoad(ctx('giver'))
      }),
    ).toBeUndefined()
  })
})
