import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { getWeekFn } from '~/server/settlement/functions'
import { getDisputeListFn } from '~/server/disputes/functions'
import { getProposalsFn } from '~/server/periods/functions'
import { defaultsProposal, periodProposal, proposalsView } from '../proposals/fixtures'
import { takerWeek, week } from './fixtures'

// Týden through its route (#45): the loader's call, the title per role, no placeholder.
const page = vi.hoisted(() => ({
  data: {},
  user: { id: 3, role: 'taker', displayName: 'Starší' },
  features: { disputes: false },
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
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/server/periods/functions', () => ({
  getProposalsFn: vi.fn(() => Promise.resolve(proposalsView())),
}))
vi.mock('~/server/disputes/functions', () => ({
  getDisputeListFn: vi.fn(() => Promise.resolve([])),
  openDisputeFn: vi.fn(),
}))
vi.mock('~/server/settlement/functions', () => ({
  getWeekFn: vi.fn(() => Promise.resolve('week')),
}))

const { Route } = await import('~/routes/_app/tyden/index')
const Page = (Route as unknown as { component: () => ReactNode }).component

describe('Týden page', () => {
  interface Features {
    periodProposals: boolean
    disputes: boolean
  }
  type Loader = (a: { context: { features: Features } }) => Promise<unknown>
  const load = (periodProposals: boolean, disputes = false) =>
    (Route as unknown as { loader: Loader }).loader({
      context: { features: { periodProposals, disputes } },
    })

  it('the loader asks for the week; with the switch off nothing about proposals', async () => {
    expect(await load(false)).toEqual({ week: 'week', proposals: null, disputeList: null })
    expect(getWeekFn).toHaveBeenCalledTimes(1)
    expect(getProposalsFn).not.toHaveBeenCalled()
  })

  it('switch on: the loader also asks for the proposals, once', async () => {
    expect(await load(true)).toEqual({
      week: 'week',
      proposals: proposalsView(),
      disputeList: null,
    })
    expect(getProposalsFn).toHaveBeenCalledTimes(1)
  })

  it('disputes switch on: the loader also asks for Rozporováno; off it does not', async () => {
    expect(getDisputeListFn).not.toHaveBeenCalled()
    expect(await load(false, true)).toEqual({ week: 'week', proposals: null, disputeList: [] })
    expect(getDisputeListFn).toHaveBeenCalledTimes(1)
  })

  it('disputes switch on: Rozporovat on the giver Týden; off: none', () => {
    page.user = { id: 2, role: 'giver', displayName: 'Táta' }
    page.data = { week: week(), proposals: null, disputeList: [] }
    page.features = { disputes: false }
    expect(renderToStaticMarkup(<Page />)).not.toContain(cs.disputes.action)
    page.features = { disputes: true }
    expect(renderToStaticMarkup(<Page />)).toContain(`>${cs.disputes.action}<`)
    page.features = { disputes: false }
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
