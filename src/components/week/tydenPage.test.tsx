import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { marker, withMarker } from '~/lib/liveSubs.testing'
import { cs } from '~/lib/strings'
import { getWeekFn } from '~/server/settlement/functions'
import { getDisputeListFn } from '~/server/disputes/functions'
import { getProposalsFn } from '~/server/periods/functions'
import { defaultsProposal, periodProposal, proposalsView } from '../proposals/fixtures'
import { getWeekPlanFn } from '~/server/instances/functions'
import { planFixture, takerWeek, week } from './fixtures'

// Týden through its route (#45): the loader's call, the title per role, no placeholder.
const page = vi.hoisted(() => ({
  data: {},
  user: { id: 3, role: 'taker', displayName: 'Starší' },
  features: { disputes: false, openRows: false },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: page.user, features: page.features }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouterState: () => ({ location: { pathname: '/tyden' } }),
  useRouter: () => ({ invalidate: vi.fn() }),
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
      <a href={to}>{children}</a>
    ),
}))
vi.mock('~/server/periods/functions', () => ({
  getProposalsFn: vi.fn(() => Promise.resolve(withMarker('getProposalsFn', proposalsView()))),
}))
vi.mock('~/server/disputes/functions', () => ({
  getDisputeListFn: vi.fn(() => Promise.resolve(withMarker('getDisputeListFn', []))),
  openDisputeFn: vi.fn(),
}))
vi.mock('~/server/instances/functions', () => ({
  getWeekPlanFn: vi.fn(() => Promise.resolve(withMarker('getWeekPlanFn', 'plan'))),
}))
vi.mock('~/server/settlement/functions', () => ({
  getWeekFn: vi.fn(() => Promise.resolve(withMarker('getWeekFn', 'week'))),
}))

const { Route } = await import('~/routes/_app/tyden/index')
const Page = (Route as unknown as { component: () => ReactNode }).component

describe('Týden page', () => {
  interface Features {
    periodProposals: boolean
    disputes: boolean
    weekPlan?: boolean
  }
  type Loader = (a: { context: { features: Features } }) => Promise<unknown>
  const load = (periodProposals: boolean, disputes = false, weekPlan = false) =>
    (Route as unknown as { loader: Loader }).loader({
      context: { features: { periodProposals, disputes, weekPlan } },
    })

  it('weekPlan off: no card and no getWeekPlanFn call', async () => {
    expect(await load(false)).toMatchObject({ plan: null })
    expect(getWeekPlanFn).not.toHaveBeenCalled()
    page.user = { id: 3, role: 'taker', displayName: 'Starší' }
    page.data = { week: takerWeek(), proposals: null, plan: null }
    expect(renderToStaticMarkup(<Page />)).not.toContain('href="/tyden/plan"')
  })

  it('weekPlan on: the loader asks for the plan once; the card links to /tyden/plan with "Volných: 2" and sits before the tabs', async () => {
    expect(await load(false, false, true)).toMatchObject({
      plan: 'plan',
      live: [marker('getWeekFn'), marker('getWeekPlanFn')],
    })
    expect(getWeekPlanFn).toHaveBeenCalledTimes(1)
    page.user = { id: 3, role: 'taker', displayName: 'Starší' }
    // The fixture's free copies from today on: Wednesday's table and one of the two vacuums.
    page.data = { week: takerWeek(), proposals: null, plan: planFixture() }
    const html = renderToStaticMarkup(<Page />)
    expect(html).toContain('Rozděl si úkoly na dny. Volných: 2')
    expect(html).toContain('href="/tyden/plan"')
    expect(html.indexOf('href="/tyden/plan"')).toBeGreaterThan(-1)
    expect(html.indexOf('href="/tyden/plan"')).toBeLessThan(html.indexOf('role="tablist"'))
    page.data = { week: takerWeek(), proposals: null, plan: { error: 'feature_off' } }
    expect(renderToStaticMarkup(<Page />)).not.toContain('href="/tyden/plan"')
  })

  it('weekPlan on, a giver: Kdo co dělá který den.', () => {
    page.user = { id: 2, role: 'giver', displayName: 'Táta' }
    page.data = { week: week(), proposals: null, plan: planFixture() }
    expect(renderToStaticMarkup(<Page />)).toContain('Kdo co dělá který den. Volných: 2')
  })

  it('the loader asks for the week; with the switch off nothing about proposals', async () => {
    expect(await load(false)).toEqual({
      week: 'week',
      proposals: null,
      disputeList: null,
      plan: null,
      live: [marker('getWeekFn')],
    })
    expect(getWeekFn).toHaveBeenCalledTimes(1)
    expect(getProposalsFn).not.toHaveBeenCalled()
  })

  it('switch on: the loader also asks for the proposals, once', async () => {
    expect(await load(true)).toEqual({
      week: 'week',
      proposals: proposalsView(),
      disputeList: null,
      plan: null,
      live: [marker('getWeekFn'), marker('getProposalsFn')],
    })
    expect(getProposalsFn).toHaveBeenCalledTimes(1)
  })

  it('disputes switch on: the loader also asks for Rozporováno; off it does not', async () => {
    expect(getDisputeListFn).not.toHaveBeenCalled()
    expect(await load(false, true)).toEqual({
      week: 'week',
      proposals: null,
      disputeList: [],
      plan: null,
      live: [marker('getWeekFn'), marker('getDisputeListFn')],
    })
    expect((await load(true, true)) as { live: unknown }).toMatchObject({
      live: [marker('getWeekFn'), marker('getProposalsFn'), marker('getDisputeListFn')],
    })
    expect(getDisputeListFn).toHaveBeenCalledTimes(2)
  })

  it('disputes switch on: Rozporovat on the giver Týden; off: none', () => {
    page.user = { id: 2, role: 'giver', displayName: 'Táta' }
    page.data = { week: week(), proposals: null, disputeList: [] }
    page.features = { disputes: false, openRows: false }
    expect(renderToStaticMarkup(<Page />)).not.toContain(cs.disputes.action)
    page.features = { disputes: true, openRows: false }
    expect(renderToStaticMarkup(<Page />)).toContain(`>${cs.disputes.action}<`)
    page.features = { disputes: false, openRows: false }
  })

  it('the Příští týden card shows only with proposals loaded; Návrh čeká while one is open', () => {
    page.user = { id: 3, role: 'taker', displayName: 'Starší' }
    page.data = { week: takerWeek(), proposals: null }
    expect(renderToStaticMarkup(<Page />)).not.toContain(cs.proposals.entry.card)
    page.data = { week: takerWeek(), proposals: proposalsView() }
    const idle = renderToStaticMarkup(<Page />)
    expect(idle).toContain(cs.proposals.entry.card)
    expect(idle).not.toContain(cs.proposals.entry.pending)
    page.data = { week: takerWeek(), proposals: proposalsView({ period: periodProposal() }) }
    expect(renderToStaticMarkup(<Page />)).toContain(cs.proposals.entry.pending)
    page.data = { week: takerWeek(), proposals: proposalsView({ defaults: defaultsProposal() }) }
    expect(renderToStaticMarkup(<Page />)).toContain(cs.proposals.entry.pending)
  })

  it('a taker: Můj týden, his week, not the placeholder', () => {
    page.user = { id: 3, role: 'taker', displayName: 'Starší' }
    page.data = { week: takerWeek(), proposals: null }
    const html = renderToStaticMarkup(<Page />)
    expect(html).toContain(cs.week.myTitle)
    expect(html).toContain('data-taker="3"')
    expect(html).not.toContain(cs.placeholder.soon)
  })

  it('a giver: Týden with names', () => {
    page.user = { id: 2, role: 'giver', displayName: 'Táta' }
    page.data = { week: week(), proposals: null }
    const html = renderToStaticMarkup(<Page />)
    expect(html).toContain(`>${cs.nav.week}<`)
    expect(html).toContain('>Mladší</p>')
  })
})

describe('switch openRows (#205): Co se tento týden stalo rows open their task', () => {
  it('switch on: each item links to /ukol/<taskId>; off: none', () => {
    page.user = { id: 2, role: 'giver', displayName: 'Táta' }
    page.data = { week: week(), proposals: null, disputeList: [] }
    page.features = { disputes: false, openRows: true }
    const html = renderToStaticMarkup(<Page />)
    expect(html).toMatch(/<a href="\/ukol\/11" class="[^"]*after:inset-0[^"]*">Zalít kytky<\/a>/)
    expect(html).toMatch(/<a href="\/ukol\/12" class="[^"]*after:inset-0[^"]*">Vynést sklo<\/a>/)
    page.features = { disputes: false, openRows: false }
    expect(renderToStaticMarkup(<Page />)).not.toContain('after:inset-0')
  })
})
