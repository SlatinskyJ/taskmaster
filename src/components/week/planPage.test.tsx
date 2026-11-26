import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { getWeekPlanFn } from '~/server/instances/functions'
import { planFixture } from './fixtures'

// Plán týdne through its route (#258): the switch, the role guard, the loader and the screen.
// Lives here, not in src/routes, because the router generator treats every file there as a route.
const page = vi.hoisted(() => ({
  data: {},
  user: { id: 3, role: 'taker', displayName: 'Starší' },
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: page.user }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn((to: unknown) => ({ redirect: to })),
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/tyden/plan' } }),
  Link: ({ to, children }: { to?: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('~/server/instances/functions', () => ({
  getWeekPlanFn: vi.fn(() => Promise.resolve('plan')),
}))
vi.mock('~/server/tasks/functions', () => ({ reserveTaskFn: vi.fn(), releaseTaskFn: vi.fn() }))

interface RouteOpts {
  beforeLoad: (a: { context: unknown }) => void
  loader: () => Promise<unknown>
  component: () => ReactNode
}
const plan = (await import('~/routes/_app/tyden/plan')).Route as unknown as RouteOpts

const context = (role: string, weekPlan: boolean) => ({
  context: { user: { id: 3, role }, features: { weekPlan } },
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

describe('Plán týdne route (#258)', () => {
  it('loader calls getWeekPlanFn once', async () => {
    expect(await plan.loader()).toBe('plan')
    expect(getWeekPlanFn).toHaveBeenCalledTimes(1)
  })

  it('beforeLoad redirects to /tyden with weekPlan off; stays for a taker and a giver with it on', () => {
    expect(
      thrown(() => {
        plan.beforeLoad(context('taker', false))
      }),
    ).toEqual({
      redirect: { to: '/tyden' },
    })
    expect(
      thrown(() => {
        plan.beforeLoad(context('taker', true))
      }),
    ).toBeUndefined()
    expect(
      thrown(() => {
        plan.beforeLoad(context('giver', true))
      }),
    ).toBeUndefined()
  })

  it('the admin goes to his landing page', () => {
    expect(
      thrown(() => {
        plan.beforeLoad(context('admin', true))
      }),
    ).toEqual({
      redirect: { to: '/sprava' },
    })
  })

  it("title Plán týdne, back to /tyden, the week's dates", () => {
    page.data = planFixture()
    const html = renderToStaticMarkup(<plan.component />)
    expect(html).toContain(`>${cs.plan.title}<`)
    expect(html).toContain('href="/tyden"')
    // Sideways, the screen takes the phone's width, so every day fits.
    expect(html).toContain('landscape:max-w-3xl')
    expect(html).toContain('29. 11. – 6. 12.')
    expect(html).toContain('aria-label="Prostřít stůl k večeři, St: volné, rezervovat"')
  })

  it('feature_off answer shows the not-allowed card', () => {
    page.data = { error: 'feature_off' }
    const html = renderToStaticMarkup(<plan.component />)
    expect(html).toContain(cs.tasks.errors.notAllowed)
    expect(html).not.toContain('data-slot="plan-days"')
  })
})
