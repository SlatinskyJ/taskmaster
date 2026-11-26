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
    waitingFor: { id: number; name: string }[]
    disputes: boolean
    mark: unknown
  } = {
    user: null,
    template: null,
    thread: [],
    waitingFor: [],
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
      waitingFor: page.waitingFor,
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
  description: null,
  status: 'active',
  score: 3,
  approvalRequired: true,
  createdByName: 'Táta',
  approvedBy: [],
  schedule: null,
  deadline: null,
  bidding: null,
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

function render(user: PageUser, entries: ThreadEntry[] = thread, template: TemplateView = dishes) {
  page.user = user
  page.template = template
  page.thread = entries
  const Page = (Route as unknown as { component: () => ReactNode }).component
  return renderToStaticMarkup(<Page />)
}

const STARSI = { id: 4, role: 'taker', displayName: 'Starší' } as const
const TATA = { id: 2, role: 'giver', displayName: 'Táta' } as const

describe('template price page', () => {
  it('a proposed chore with bidding shows Návrh: 10 b. and no future-only line (#209)', () => {
    const chore: TemplateView = {
      ...dishes,
      status: 'proposed',
      score: 10,
      change: null,
      bidding: {
        offer: { score: 10, byName: 'Táta' },
        bids: [{ takerId: 4, name: 'Starší', score: 12 }],
        lowest: 12,
        lastBids: [{ takerId: 4, score: 12 }],
      },
    }
    const html = render(STARSI, [], chore)
    expect(html).toContain('Návrh: 10 b.')
    expect(html).not.toContain('Platí 10 b.')
    expect(html).not.toContain('Nová cena platí jen pro nově vzniklé úkoly.')
    expect(html).toContain('Nechci')
  })

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

describe('a proposed chore’s page (#205)', () => {
  const bins: TemplateView = {
    ...dishes,
    id: 11,
    title: 'Vynést koše',
    status: 'proposed',
    score: 4,
    approvedBy: ['Táta'],
    change: null,
  }
  const both = [
    { id: 4, name: 'Starší' },
    { id: 5, name: 'Mladší' },
  ]

  it('Starší, waited for: Návrh, the proposed score, who agreed, who it waits for, Souhlasím', () => {
    page.waitingFor = both
    const html = render(STARSI, [], bins)
    page.waitingFor = []
    expect(html).toContain('Návrh')
    expect(html).toContain('Navržená cena: 4 b.')
    expect(html).toContain('Začne platit, až souhlasí všichni.')
    expect(html).not.toContain('Platí')
    expect(html).toContain('Souhlasí: Táta')
    expect(html).toContain('Čeká se na: tebe nebo Mladší')
    expect(html).toMatch(new RegExp(`<button[^>]*>${cs.tasks.approve}</button>`))
    expect(html).not.toContain('Historie ceny')
    expect(html).not.toContain('Nová cena platí jen pro nově vzniklé úkoly.')
  })

  it('not waited for (a parent): who it waits for, no Souhlasím', () => {
    page.waitingFor = both
    const html = render(TATA, [], bins)
    page.waitingFor = []
    expect(html).toContain('Čeká se na: Starší nebo Mladší')
    expect(html).not.toContain(`>${cs.tasks.approve}<`)
  })

  it('an agreed chore keeps its Platí line and history', () => {
    const html = render(STARSI)
    expect(html).toContain('Platí 3 b.')
    expect(html).not.toContain('Navržená cena')
    expect(html).toContain('Historie ceny')
  })
})
