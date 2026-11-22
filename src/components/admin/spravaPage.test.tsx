import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { cs } from '~/lib/strings'
import { listPasskeyCountsFn } from '~/server/passkeys/functions'
import { getPeriodDefaultsFn } from '~/server/periods/functions'
import { listUsersFn } from '~/server/users/functions'

// Správa through its route (#47): the loader asks for the default week, and the page renders the
// Výchozí týden card above Lidé. Lives here, not in src/routes (the router generator owns that).
const page = vi.hoisted(() => ({ data: {} }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: { id: 1, role: 'admin', displayName: 'Admin' } }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/sprava' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/server/users/functions', () => ({
  listUsersFn: vi.fn(() => Promise.resolve([])),
  createUserFn: vi.fn(),
  updateUserFn: vi.fn(),
  resetPasswordFn: vi.fn(),
}))
vi.mock('~/server/passkeys/functions', () => ({
  listPasskeyCountsFn: vi.fn(() => Promise.resolve({})),
  removeUserPasskeysFn: vi.fn(),
}))
vi.mock('~/server/periods/functions', () => ({
  getPeriodDefaultsFn: vi.fn(() => Promise.resolve('defaults')),
  savePeriodDefaultsFn: vi.fn(),
}))

const { Route } = await import('~/routes/_app/sprava')
const route = Route as unknown as {
  loader: () => Promise<unknown>
  component: () => ReactNode
}

describe('Správa route', () => {
  it('loads the default week with people and passkeys', async () => {
    await expect(route.loader()).resolves.toEqual({
      people: [],
      passkeys: {},
      defaults: 'defaults',
    })
    expect(getPeriodDefaultsFn).toHaveBeenCalled()
    expect(listUsersFn).toHaveBeenCalled()
    expect(listPasskeyCountsFn).toHaveBeenCalled()
  })

  it('renders Výchozí týden before Lidé', () => {
    page.data = { people: [], passkeys: {}, defaults: DEFAULT_PERIOD_DEFAULTS }
    const Page = route.component
    const html = renderToStaticMarkup(<Page />)
    const week = html.indexOf(cs.admin.defaults.title)
    expect(week).toBeGreaterThan(-1)
    expect(week).toBeLessThan(html.indexOf(`>${cs.admin.people}<`))
    expect(html).toContain('7 dní')
  })
})
