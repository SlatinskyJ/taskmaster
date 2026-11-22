import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { getMeetingFn } from '~/server/settlement/functions'
import { listPlanTasksFn } from '~/server/tasks/functions'
import { cs } from '~/lib/strings'
import { pendingWeek } from './fixtures'

// Schůzka through its route (#44): the loader's calls and that the page renders the meeting,
// not the old placeholder. Lives here, not in src/routes (the router generator owns that).
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
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/schuzka' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/server/settlement/functions', () => ({
  getMeetingFn: vi.fn(() => Promise.resolve('meeting')),
  settlePeriodFn: vi.fn(),
}))
vi.mock('~/server/tasks/functions', () => ({
  listPlanTasksFn: vi.fn(() => Promise.resolve('plan')),
  approveTaskFn: vi.fn(),
  rejectTaskFn: vi.fn(),
}))

const { Route } = await import('~/routes/_app/schuzka')

describe('Schůzka page', () => {
  it('the loader asks for the meeting and the plan tasks', async () => {
    const loader = (Route as unknown as { loader: () => Promise<unknown> }).loader
    expect(await loader()).toEqual({ meeting: 'meeting', plan: 'plan' })
    expect(getMeetingFn).toHaveBeenCalledTimes(1)
    expect(listPlanTasksFn).toHaveBeenCalledTimes(1)
  })

  it('renders the meeting, not the placeholder', () => {
    page.data = { meeting: pendingWeek(), plan: [] }
    const Page = (Route as unknown as { component: () => ReactNode }).component
    const html = renderToStaticMarkup(<Page />)
    expect(html).toContain('Schůzka')
    expect(html).toContain('Zalít kytky')
    expect(html).toContain('Zbývá schválit: 2')
    expect(html).not.toContain(cs.placeholder.soon)
  })
})
