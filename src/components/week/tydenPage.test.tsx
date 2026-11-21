import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { getWeekFn } from '~/server/settlement/functions'
import { takerWeek, week } from './fixtures'

// Týden through its route (#45): the loader's call, the title per role, no placeholder.
const page = vi.hoisted(() => ({ data: {}, user: { id: 3, role: 'taker', displayName: 'Starší' } }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: page.user }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouterState: () => ({ location: { pathname: '/tyden' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/server/settlement/functions', () => ({
  getWeekFn: vi.fn(() => Promise.resolve('week')),
}))

const { Route } = await import('~/routes/_app/tyden')
const Page = (Route as unknown as { component: () => ReactNode }).component

describe('Týden page', () => {
  it('the loader asks for the week', async () => {
    const loader = (Route as unknown as { loader: () => Promise<unknown> }).loader
    expect(await loader()).toBe('week')
    expect(getWeekFn).toHaveBeenCalledTimes(1)
  })

  it('a taker: Můj týden, his week, not the placeholder', () => {
    page.user = { id: 3, role: 'taker', displayName: 'Starší' }
    page.data = takerWeek()
    const html = renderToStaticMarkup(<Page />)
    expect(html).toContain(cs.week.myTitle)
    expect(html).toContain('data-taker="3"')
    expect(html).not.toContain(cs.placeholder.soon)
  })

  it('a giver: Týden with names', () => {
    page.user = { id: 2, role: 'giver', displayName: 'Táta' }
    page.data = week()
    const html = renderToStaticMarkup(<Page />)
    expect(html).toContain(`>${cs.nav.week}<`)
    expect(html).toContain('>Mladší</p>')
  })
})
