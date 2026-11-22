import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { ThreadEntry } from '~/server/tasks/functions'
import type { TemplateView } from '~/server/templates/functions'

// The template price page itself (#138), rendered statically through its route: the router
// hands the page the test's user, template and thread. Lives here, not in src/routes, because
// the router generator treats every file there as a route.
interface PageUser {
  id: number
  role: 'taker' | 'giver'
  displayName: string
}
const page = vi.hoisted(() => {
  const state: {
    user: PageUser | null
    template: unknown
    thread: unknown[]
    disputes: boolean
    mark: unknown
  } = {
    user: null,
    template: null,
    thread: [],
    disputes: false,
    mark: null,
  }
  return state
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: page.user, features: { disputes: page.disputes } }),
    useLoaderData: () => ({
      template: page.template,
      thread: page.thread,
      disputeMark: page.mark,
    }),
  }),
  notFound: () => new Error('not found'),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('~/components/tasks/useTaskAction', () => ({
  useTaskAction: () => ({ busy: null, run: vi.fn() }),
}))
vi.mock('./priceCalls', () => ({ callPrice: vi.fn(), PRICE_CALLS: {} }))
vi.mock('~/server/templates/functions', () => ({
  getTemplateDetailFn: vi.fn(() => Promise.resolve({ template: page.template, thread: [] })),
}))
vi.mock('~/server/disputes/functions', () => ({
  getItemMarkFn: vi.fn(() => Promise.resolve(null)),
  openDisputeFn: vi.fn(),
}))

const { Route } = await import('~/routes/_app/sablona/$templateId')
const { getItemMarkFn } = await import('~/server/disputes/functions')

const dishes: TemplateView = {
  id: 9,
  title: 'Vyluxovat celý obývák a chodbu',
  status: 'active',
  score: 3,
  approvalRequired: true,
  createdByName: 'Táta',
  approvedBy: [],
  schedule: null,
  deadline: null,
  change: {
    offer: { score: 4, byName: 'Táta' },
    bids: [{ takerId: 5, name: 'Mladší', score: 5 }],
    lowest: 5,
  },
}
const thread: ThreadEntry[] = [
  {
    id: 1,
    side: 'taker',
    by: { id: 5, name: 'Mladší' },
    score: 5,
    at: '2026-11-21T09:00:00.000Z',
    state: 'open',
  },
  {
    id: 2,
    side: 'giver',
    by: { id: 2, name: 'Táta' },
    score: 4,
    at: '2026-11-21T09:05:00.000Z',
    state: 'open',
  },
]

function render(user: PageUser, entries: ThreadEntry[] = thread) {
  page.user = user
  page.template = dishes
  page.thread = entries
  const Page = (Route as unknown as { component: () => ReactNode }).component
  return renderToStaticMarkup(<Page />)
}

const STARSI = { id: 4, role: 'taker', displayName: 'Starší' } as const
const TATA = { id: 2, role: 'giver', displayName: 'Táta' } as const

describe('template price page', () => {
  it('a brother sees the score, the offer, the history and his buttons', () => {
    const html = render(STARSI)
    expect(html).toContain('Vyluxovat celý obývák a chodbu')
    expect(html).toContain('Platí 3 b.')
    expect(html).toContain('Nová cena platí jen pro nově vzniklé úkoly.')
    expect(html).toContain('Historie ceny')
    expect(html).toContain('Mladší chce')
    expect(html).toContain('Přijmout 4')
    expect(html).toContain(`aria-label="${cs.tasks.less}"`)
  })

  it('a parent gets the lowest bid to accept', () => {
    const html = render(TATA)
    expect(html).toContain('Přijmout 5 (Mladší)')
    expect(html).toContain('Ty nabízíš')
  })

  it('no history yet: the empty line', () => {
    expect(render(TATA, [])).toContain('Zatím beze změny ceny.')
  })
})

describe('template page: Rozporovat (#46)', () => {
  type Loader = (a: {
    params: { templateId: string }
    context: { features: { disputes: boolean } }
  }) => Promise<{ disputeMark: unknown }>
  const load = (template: TemplateView, disputes: boolean) => {
    page.template = template
    vi.mocked(getItemMarkFn).mockClear()
    return (Route as unknown as { loader: Loader }).loader({
      params: { templateId: String(template.id) },
      context: { features: { disputes } },
    })
  }

  it('loader: an active template reads its score mark with the switch on, else nothing', async () => {
    expect((await load(dishes, true)).disputeMark).toBeNull()
    expect(vi.mocked(getItemMarkFn).mock.calls).toEqual([
      [{ data: { kind: 'template_score', id: 9 } }],
    ])
    await load(dishes, false)
    await load({ ...dishes, status: 'proposed' }, true)
    expect(getItemMarkFn).not.toHaveBeenCalled()
  })

  it('active, switch on: Rozporovat on the score; off: none', () => {
    page.disputes = true
    const html = render(TATA)
    page.disputes = false
    expect(html).toContain(
      'aria-label="Rozporovat: Body za opakovaný úkol – Vyluxovat celý obývák a chodbu"',
    )
    // Led by what it disputes, so it doesn't read as a reply to the bid above it.
    expect(html).toContain(`>${cs.disputes.what.template_score}<`)
    expect(render(TATA)).not.toContain('data-slot="dispute"')
  })
})
