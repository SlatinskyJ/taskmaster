import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { getProposalsFn } from '~/server/periods/functions'
import { proposalsView } from './fixtures'

// Příští týden and Výchozí týden through their routes: the switch, the role guard and the
// loader. Lives here, not in src/routes, because the router generator treats every file there
// as a route.
const page = vi.hoisted(() => ({
  data: {},
  user: { id: 4, role: 'taker', displayName: 'Mladší' },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: page.user }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn((to: unknown) => ({ redirect: to })),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/tyden/pristi' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/server/periods/functions', () => ({
  getProposalsFn: vi.fn(() => Promise.resolve('view')),
  approveProposalFn: vi.fn(),
  rejectProposalFn: vi.fn(),
  withdrawProposalFn: vi.fn(),
  proposePeriodFn: vi.fn(),
  proposeDefaultsFn: vi.fn(),
}))

interface RouteOpts {
  beforeLoad: (a: { context: unknown }) => void
  loader: () => Promise<unknown>
  component: () => ReactNode
}
const pristi = (await import('~/routes/_app/tyden/pristi')).Route as unknown as RouteOpts
const vychozi = (await import('~/routes/_app/tyden/vychozi')).Route as unknown as RouteOpts

const context = (role: string, periodProposals: boolean) => ({
  context: { user: { id: 4, role }, features: { periodProposals } },
})
const thrown = (f: () => void): unknown => {
  try {
    f()
  } catch (e) {
    return e
  }
  return undefined
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Příští týden route', () => {
  it('switch off → back to Týden', () => {
    expect(
      thrown(() => {
        pristi.beforeLoad(context('taker', false))
      }),
    ).toEqual({
      redirect: { to: '/tyden' },
    })
  })

  it('switch on → no redirect; the loader asks for the proposals once', async () => {
    expect(
      thrown(() => {
        pristi.beforeLoad(context('taker', true))
      }),
    ).toBeUndefined()
    expect(
      thrown(() => {
        pristi.beforeLoad(context('giver', true))
      }),
    ).toBeUndefined()
    expect(await pristi.loader()).toBe('view')
    expect(getProposalsFn).toHaveBeenCalledTimes(1)
  })

  it('the admin goes to his landing page', () => {
    expect(
      thrown(() => {
        pristi.beforeLoad(context('admin', true))
      }),
    ).toEqual({
      redirect: { to: '/sprava' },
    })
  })

  it('renders the screen with its title and back button', () => {
    page.data = proposalsView()
    const html = renderToStaticMarkup(<pristi.component />)
    expect(html).toContain(cs.proposals.title)
    expect(html).toContain(cs.proposals.thisWeek)
  })
})

describe('Výchozí týden route', () => {
  it('switch off → back to Týden', () => {
    expect(
      thrown(() => {
        vychozi.beforeLoad(context('giver', false))
      }),
    ).toEqual({
      redirect: { to: '/tyden' },
    })
  })

  it('a taker goes to his landing page', () => {
    expect(
      thrown(() => {
        vychozi.beforeLoad(context('taker', true))
      }),
    ).toEqual({
      redirect: { to: '/' },
    })
  })

  it('a giver with the switch on stays', () => {
    expect(
      thrown(() => {
        vychozi.beforeLoad(context('giver', true))
      }),
    ).toBeUndefined()
  })
})
