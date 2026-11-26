import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { FEATURE_KEYS, NO_FEATURES } from '~/lib/features'
import { cs } from '~/lib/strings'
import { listPasskeyCountsFn } from '~/server/passkeys/functions'
import { getAdminDisputesFn } from '~/server/disputes/functions'
import { getFeaturesFn } from '~/server/features/functions'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import { getPeriodDefaultsFn } from '~/server/periods/functions'
import { getAdminSuggestionsFn } from '~/server/suggestions/functions'
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
vi.mock('~/server/disputes/functions', () => ({
  getAdminDisputesFn: vi.fn(() => Promise.resolve([])),
  dismissDisputeFn: vi.fn(),
}))
vi.mock('~/server/corrections/functions', () => ({
  getFixableFn: vi.fn(() => Promise.resolve([])),
  adjustPointsFn: vi.fn(),
  correctSettlementFn: vi.fn(),
}))
vi.mock('~/server/features/functions', () => ({
  getFeaturesFn: vi.fn(() => Promise.resolve({ ...NO_FEATURES, log: true })),
  setSwitchFn: vi.fn(),
}))
vi.mock('~/server/suggestions/functions', () => ({
  getAdminSuggestionsFn: vi.fn(() => Promise.resolve({ items: [], canSend: false })),
  closeSuggestionFn: vi.fn(),
  sendSuggestionFn: vi.fn(),
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
      disputes: [],
      fixable: [],
      switches: { ...NO_FEATURES, log: true },
      suggestions: { items: [], canSend: false },
    })
    expect(getPeriodDefaultsFn).toHaveBeenCalled()
    expect(getFeaturesFn).toHaveBeenCalled()
    expect(listUsersFn).toHaveBeenCalled()
    expect(listPasskeyCountsFn).toHaveBeenCalled()
    expect(getAdminDisputesFn).toHaveBeenCalled()
  })

  it('a failed disputes fetch gives the retry state, the rest still loads', async () => {
    vi.mocked(getAdminDisputesFn).mockRejectedValueOnce(new Error('net'))
    await expect(route.loader()).resolves.toMatchObject({
      defaults: 'defaults',
      disputes: { error: 'load' },
    })
  })

  it('renders Výchozí týden before Lidé', () => {
    page.data = {
      people: [],
      passkeys: {},
      defaults: DEFAULT_PERIOD_DEFAULTS,
      disputes: [],
      fixable: [],
      switches: NO_FEATURES,
      suggestions: { items: [], canSend: false },
    }
    const Page = route.component
    const html = renderToStaticMarkup(<Page />)
    const week = html.indexOf(cs.admin.defaults.title)
    expect(week).toBeGreaterThan(-1)
    expect(week).toBeLessThan(html.indexOf(`>${cs.admin.people}<`))
    expect(html).toContain('7 dní')
  })
})

describe('Správa: Sporné (#47)', () => {
  const entry: AdminDisputeEntry = {
    id: 5,
    item: { kind: 'completion', id: 10 },
    title: 'Vysát auto',
    week: null,
    takerName: 'Starší',
    takerId: 3,
    openedByName: 'Starší',
    reason: 'Vysával jsem i kufr.',
    openedAt: '2026-11-22T10:00:00.000Z',
    value: { score: 8 },
    page: null,
  }
  const render = (
    disputes: unknown,
    fixable: unknown = [],
    suggestions: unknown = { error: 'feature_off' },
    switches: unknown = NO_FEATURES,
  ) => {
    page.data = {
      people: [],
      passkeys: {},
      defaults: DEFAULT_PERIOD_DEFAULTS,
      disputes,
      fixable,
      switches,
      suggestions,
    }
    const Page = route.component
    return renderToStaticMarkup(<Page />)
  }

  it('renders Sporné (n) above Výchozí týden', () => {
    const html = render([entry, { ...entry, id: 6 }])
    const disputes = html.indexOf(cs.admin.disputes.title(2))
    expect(disputes).toBeGreaterThan(-1)
    expect(disputes).toBeLessThan(html.indexOf(cs.admin.defaults.title))
  })

  it('has no Sporné section with the switch off', () => {
    const html = render({ error: 'feature_off' })
    expect(html).not.toContain(cs.state.disputed)
  })

  it('shows the load error and a retry after a failed fetch', () => {
    const html = render({ error: 'load' })
    expect(html).toContain(cs.admin.disputes.loadError)
    expect(html).toContain(cs.admin.disputes.retry)
  })

  it('Opravy bodů sits under Sporné, above Výchozí týden (#48)', () => {
    const html = render([entry])
    const fix = html.indexOf(cs.admin.fix.title)
    expect(fix).toBeGreaterThan(html.indexOf(cs.admin.disputes.title(1)))
    expect(fix).toBeLessThan(html.indexOf(cs.admin.defaults.title))
    expect(html).toContain(`>${cs.admin.disputes.fix}<`)
  })

  it('switch off: no Opravy bodů and no Opravit', () => {
    const html = render({ error: 'feature_off' }, { error: 'feature_off' })
    expect(html).not.toContain(cs.admin.fix.title)
    expect(html).not.toContain(`>${cs.admin.disputes.fix}<`)
  })

  it('a failed fix fetch: its load error and retry', () => {
    const html = render([], { error: 'load' })
    expect(html).toContain(cs.admin.fix.loadError)
  })

  it('Návrhy (#247) sits under Sporné, above Opravy bodů', () => {
    const html = render([entry], [], { items: [], canSend: false })
    const suggestions = html.indexOf(`>${cs.suggestions.adminTitle(0)}<`)
    expect(suggestions).toBeGreaterThan(html.indexOf(cs.admin.disputes.title(1)))
    expect(suggestions).toBeLessThan(html.indexOf(cs.admin.fix.title))
  })

  it('suggestions switch off: no Návrhy text at all', () => {
    // Funkce in its error state: its list names the switches, Návrhy zlepšení among them (#296).
    const html = render([entry], [], { error: 'feature_off' }, { error: 'failed' })
    expect(html).not.toContain('Návrh')
  })

  it('a failed suggestions fetch: its error and retry, the rest still renders', async () => {
    vi.mocked(getAdminSuggestionsFn).mockRejectedValueOnce(new Error('net'))
    await expect(route.loader()).resolves.toMatchObject({
      defaults: 'defaults',
      suggestions: { error: 'load' },
    })
    const html = render([entry], [], { error: 'load' })
    expect(html).toContain(cs.suggestions.loadError)
    expect(html).toContain(cs.admin.defaults.title)
  })
})

describe('Správa: Funkce (#296)', () => {
  const render = (switches: unknown) => {
    page.data = {
      people: [],
      passkeys: {},
      defaults: DEFAULT_PERIOD_DEFAULTS,
      disputes: [],
      fixable: [],
      suggestions: { error: 'feature_off' },
      switches,
    }
    const Page = route.component
    return renderToStaticMarkup(<Page />)
  }

  it('a failed switch read gives the card its error state, the rest still loads', async () => {
    vi.mocked(getFeaturesFn).mockRejectedValueOnce(new Error('net'))
    await expect(route.loader()).resolves.toMatchObject({
      defaults: 'defaults',
      switches: { error: 'failed' },
    })
  })

  it('renders Funkce last, after Přidat člověka, one switch per launch switch', () => {
    const html = render(NO_FEATURES)
    const funkce = html.indexOf(`>${cs.admin.features.title}<`)
    expect(funkce).toBeGreaterThan(html.indexOf(`>${cs.admin.add}<`))
    expect(html.match(/role="switch"/g)).toHaveLength(FEATURE_KEYS.length)
  })

  it('shows the error state after a failed read', () => {
    const html = render({ error: 'failed' })
    expect(html).toContain(cs.admin.features.failedLoad)
    expect(html).not.toContain('role="switch"')
  })
})
