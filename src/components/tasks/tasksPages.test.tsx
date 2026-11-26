import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateView } from '~/server/templates/functions'

// Úkoly and Nový úkol rendered through their routes, so the launch switch for recurring
// templates (the app shell's `context.features`) is tested where it is read. Lives here, not in src/routes,
// because the router generator treats every file there as a route.
const page = vi.hoisted((): { data: Record<string, unknown> } => ({ data: {} }))
const features = vi.hoisted(() => ({
  recurring: true,
  log: true,
  week: true,
  meeting: true,
  descriptions: false,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: { id: 2, role: 'giver', displayName: 'Táta' }, features }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/ukoly' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))
vi.mock('~/server/tasks/functions', () => ({
  listTasksFn: vi.fn(),
  completeTaskFn: vi.fn(),
  releaseTaskFn: vi.fn(),
}))
vi.mock('~/server/templates/functions', () => ({ listTemplatesFn: vi.fn() }))
vi.mock('~/components/templates/actions', () => ({
  DEFAULT_RECURRING: { schedule: { kind: 'weekly', days: [] }, deadline: null },
  submitNewItem: vi.fn(),
}))
vi.mock('~/components/templates/RecurringFields', () => ({ RecurringFields: () => null }))

const { Route: TasksRoute } = await import('~/routes/_app/ukoly/index')
const { Route: NewRoute } = await import('~/routes/_app/ukoly/novy')

const flowers = {
  id: 10,
  title: 'Zalít kytky',
  status: 'active',
  score: 3,
  approvalRequired: true,
  createdByName: 'Táta',
  approvedBy: [],
  schedule: null,
  deadline: null,
  change: null,
} as unknown as TemplateView

function show(route: unknown) {
  const Page = (route as { component: () => ReactNode }).component
  return renderToStaticMarkup(<Page />)
}

beforeEach(() => {
  features.recurring = true
  features.descriptions = false
  page.data = { list: [], templates: [flowers] }
})

describe('Úkoly', () => {
  it('lists recurring templates under Opakované when recurring is on', () => {
    const html = show(TasksRoute)
    expect(html).toContain('Opakované')
    expect(html).toContain('Zalít kytky')
    // The top section holds one-time tasks and instances of recurring chores (#38).
    expect(html).toContain('K udělání')
  })

  it('launch: no Opakované section and no lone Jednorázové heading', () => {
    features.recurring = false
    const html = show(TasksRoute)
    expect(html).not.toContain('Opakované')
    expect(html).not.toContain('Zalít kytky')
    expect(html).not.toContain('Jednorázové')
    expect(html).not.toContain('K udělání')
    expect(html).toContain('Zatím žádné úkoly.')
  })
})

describe('Nový úkol', () => {
  it('descriptions off: no description field', () => {
    expect(show(NewRoute)).not.toContain('name="description"')
  })

  it('descriptions on: an optional field capped at 1000, with its hint', () => {
    features.descriptions = true
    const html = show(NewRoute)
    expect(html).toMatch(/<textarea[^>]*name="description"[^>]*maxLength="1000"/i)
    expect(html).toContain('Popis (nepovinné)')
    expect(html).toContain('Kluci to uvidí, než souhlasí.')
  })

  it('offers Jednorázový and Opakovaný when recurring is on', () => {
    const html = show(NewRoute)
    expect(html).toContain('Opakovaný')
    expect(html).toContain('Jednorázový')
  })

  it('launch: no kind toggle, a one-time task form only', () => {
    features.recurring = false
    const html = show(NewRoute)
    expect(html).not.toContain('Opakovaný')
    expect(html).not.toContain('Jednorázový')
    expect(html).toContain('Navrhnout')
  })
})
