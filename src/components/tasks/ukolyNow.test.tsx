import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ButtonModule from '~/components/ui/button'
import { ALL_FEATURES } from '~/lib/features'
import { cs } from '~/lib/strings'
import { createInstanceFn } from '~/server/instances/functions'
import type { TaskView } from '~/server/tasks/functions'
import type { TemplateView } from '~/server/templates/functions'

// "+ Teď" on Úkoly (#38): a parent makes an instance of an agreed template now. Rendered
// statically through the route; Button records each label's click handler and disabled flag
// (as in workButtons.test.tsx) so a test can press it.
const page = vi.hoisted(() => ({
  data: {},
  features: {},
  busy: null as string | null,
  run: vi.fn(),
  pressed: new Map<string, { onClick?: () => void; disabled?: boolean }>(),
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({
      user: { id: 2, role: 'giver', displayName: 'Táta' },
      features: page.features,
    }),
    useLoaderData: () => page.data,
  }),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/ukoly' } }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: page.busy, run: page.run }) }))
vi.mock('~/components/ui/button', async (original) => {
  const real = await original<typeof ButtonModule>()
  return {
    ...real,
    Button: (props: Parameters<typeof real.Button>[0]) => {
      if (typeof props.children === 'string') {
        page.pressed.set(props.children, {
          onClick: props.onClick as (() => void) | undefined,
          disabled: props.disabled,
        })
      }
      return real.Button(props)
    },
  }
})
vi.mock('~/server/tasks/functions', () => ({
  completeTaskFn: vi.fn(),
  listTasksFn: vi.fn(),
  releaseTaskFn: vi.fn(),
}))
vi.mock('~/server/templates/functions', () => ({ listTemplatesFn: vi.fn() }))
vi.mock('~/server/instances/functions', () => ({ createInstanceFn: vi.fn() }))

const { Route } = await import('~/routes/_app/ukoly/index')

const template = (over: Partial<TemplateView>): TemplateView => ({
  id: 5,
  title: 'Vyndat myčku',
  status: 'active',
  score: 3,
  approvalRequired: true,
  createdByName: 'Táta',
  approvedBy: [],
  schedule: null,
  deadline: null,
  bidding: null,
  lastBids: [],
  change: null,
  ...over,
})

const instance: TaskView = {
  id: 9,
  title: 'Vynést koše',
  status: 'open',
  score: 4,
  approvalRequired: true,
  createdByName: 'Táta',
  offeredByName: null,
  approvedBy: [],
  approverIds: [],
  bids: [],
  lowest: null,
  lastBids: [],
  reservedBy: null,
  completedBy: null,
  completedAt: null,
  earnerId: null,
  origin: 'on_demand',
  templateId: 6,
  dueAt: '2026-11-25T06:00:00.000Z',
  graceEndsAt: '2026-11-25T07:00:00.000Z',
  createdAt: '2026-11-24T17:00:00.000Z',
  waitingFor: [],
  scoreChange: null,
  rebidding: null,
}

function render(templates: TemplateView[], list: TaskView[] = []) {
  page.data = { list, templates }
  const Page = (Route as unknown as { component: () => ReactNode }).component
  return renderToStaticMarkup(<Page />)
}

type Run = [string, () => unknown, (r: { ok: true; id: number; score: number }) => string]

beforeEach(() => {
  page.features = { ...ALL_FEATURES }
  page.busy = null
  page.run.mockReset()
  page.pressed.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-24T17:00:00.000Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('Úkoly "+ Teď" (#38)', () => {
  it('an agreed template has it, a proposed one does not', () => {
    const html = render([template({}), template({ id: 6, status: 'proposed', title: 'Umýt okna' })])
    expect(html.split(`>${cs.instances.now}<`)).toHaveLength(2)
  })

  it('makes an instance of that template and says so', () => {
    render([template({})])
    page.pressed.get(cs.instances.now)?.onClick?.()
    const [key, fn, success] = page.run.mock.calls.at(-1) as Run
    expect(key).toBe('now-5')
    void fn()
    expect(createInstanceFn).toHaveBeenCalledWith({ data: { templateId: 5 } })
    expect(success({ ok: true, id: 9, score: 3 })).toBe(cs.instances.toast.created)
  })

  it('is enabled when nothing runs', () => {
    render([template({})])
    expect(page.pressed.get(cs.instances.now)?.disabled).toBe(false)
  })

  it('is disabled while an action runs', () => {
    page.busy = 'now-5'
    render([template({})])
    expect(page.pressed.get(cs.instances.now)?.disabled).toBe(true)
  })

  it('not there with recurring chores switched off', () => {
    page.features = { ...ALL_FEATURES, recurring: false }
    expect(render([template({})])).not.toContain(cs.instances.now)
  })

  it('an instance row shows its due time, and the top section is "K udělání"', () => {
    const html = render([], [instance])
    expect(html).toContain('do zítra 7:00')
    expect(html).toContain(cs.templates.itemsSection)
  })
})
