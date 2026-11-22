import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { HistoryEntry, TaskView } from '~/server/tasks/functions'

// The task page itself (#150), rendered statically through its route: the router hands the page
// the test's user and task. Lives here, not in src/routes, because the router generator treats
// every file there as a route.
interface PageUser {
  id: number
  role: 'taker' | 'giver'
  displayName: string
}
const page = vi.hoisted(() => {
  const state: { user: PageUser | null; task: TaskView | null; history: HistoryEntry[] } = {
    user: null,
    task: null,
    history: [],
  }
  return state
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: page.user }),
    useLoaderData: () => ({ task: page.task, thread: [], history: page.history }),
  }),
  notFound: () => new Error('not found'),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))
vi.mock('./bidCalls', () => ({ callBid: vi.fn(), BID_CALLS: {} }))
vi.mock('~/server/tasks/functions', () => ({}))

const { Route } = await import('~/routes/_app/ukol/$taskId')

const reserved: TaskView = {
  id: 1,
  title: 'Vyluxovat celý obývák a chodbu',
  status: 'reserved',
  score: 8,
  approvalRequired: true,
  createdByName: 'Táta',
  offeredByName: null,
  approvedBy: ['Táta', 'Starší'],
  approverIds: [2, 3],
  bids: [],
  lowest: null,
  reservedBy: { id: 3, name: 'Starší' },
  completedBy: null,
  completedAt: null,
  earnerId: null,
  origin: 'one_time',
  templateId: null,
  dueAt: null,
  graceEndsAt: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  waitingFor: [],
  scoreChange: null,
}

function render(user: PageUser, task: TaskView = reserved) {
  page.user = user
  page.task = task
  const Page = (Route as unknown as { component: () => ReactNode }).component
  return renderToStaticMarkup(<Page />)
}

describe('task page', () => {
  it('the task page shows Hotovo and Uvolnit to the brother who reserved it, nobody else', () => {
    const mine = render({ id: 3, role: 'taker', displayName: 'Starší' })
    expect(mine).toContain(`>${cs.work.done}<`)
    expect(mine).toContain(`>${cs.work.release}<`)
    for (const user of [
      { id: 4, role: 'taker', displayName: 'Mladší' },
      { id: 2, role: 'giver', displayName: 'Táta' },
    ] as const) {
      const html = render(user)
      expect(html).toContain('Vyluxovat celý obývák a chodbu')
      expect(html).not.toContain(`>${cs.work.done}<`)
      expect(html).not.toContain(`>${cs.work.release}<`)
    }
  })
})

describe('task page: price, cancel, history (#36)', () => {
  const TATA = { id: 2, role: 'giver', displayName: 'Táta' } as const
  const STARSI = { id: 3, role: 'taker', displayName: 'Starší' } as const
  const MLADSI = { id: 4, role: 'taker', displayName: 'Mladší' } as const

  it('a parent sees Změnit cenu (naming the brother) and Zrušit úkol; the other brother neither', () => {
    const html = render(TATA)
    expect(html).toContain(cs.taskPrice.change)
    expect(html).toContain(cs.taskPrice.needs('Starší'))
    expect(html).toContain(cs.cancelTask.action)
    const other = render(MLADSI)
    expect(other).not.toContain(cs.taskPrice.change)
    expect(other).not.toContain(cs.cancelTask.action)
    const mine = render(STARSI)
    expect(mine).toContain(cs.taskPrice.needs(cs.taskPrice.parent))
    expect(mine).not.toContain(cs.cancelTask.action)
  })

  it('an instance has no price change (its score is fixed), but shows its due time (#38)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T17:00:00.000Z'))
    const instance: TaskView = {
      ...reserved,
      origin: 'on_demand',
      templateId: 5,
      dueAt: '2026-11-25T06:00:00.000Z',
      graceEndsAt: '2026-11-25T07:00:00.000Z',
    }
    const html = render(TATA, instance)
    vi.useRealTimers()
    expect(html).not.toContain(cs.taskPrice.change)
    expect(html).toContain(cs.cancelTask.action)
    expect(html).toContain('<span class="text-meta text-muted">do zítra 7:00</span>')
    // Nothing is ever negotiated on an instance, so no empty "Vyjednávání" heading either.
    expect(html).not.toContain(cs.bids.thread)
    expect(render(TATA)).toContain(cs.bids.thread)
  })

  it('a one-time task has no due line, not even an empty one', () => {
    expect(render(TATA)).not.toContain('<span class="text-meta text-muted"></span>')
  })

  it('a proposal in flight: the brother it waits for gets Souhlasím and Nesouhlasím', () => {
    const task: TaskView = {
      ...reserved,
      scoreChange: {
        id: 5,
        score: 12,
        proposedBy: { id: 2, name: 'Táta' },
        approvedBy: [{ id: 2, name: 'Táta' }],
        waitingFor: [{ id: 3, name: 'Starší' }],
      },
    }
    const html = render(STARSI, task)
    expect(html).toContain(cs.taskPrice.pending)
    expect(html).toContain(`>${cs.taskPrice.agree}<`)
    expect(html).toContain(`>${cs.taskPrice.disagree}<`)
    expect(html).not.toContain(cs.taskPrice.change)
    expect(render(TATA, task)).toContain(`>${cs.taskPrice.withdraw}<`)
  })

  it('shows the history with the reason', () => {
    page.history = [
      {
        id: 1,
        at: '2026-11-21T09:12:00.000Z',
        action: 'task.cancelled',
        by: { id: 2, name: 'Táta' },
        score: 8,
        reservedBy: null,
        reason: 'Udělá to firma.',
      },
    ]
    const html = render(STARSI, { ...reserved, status: 'cancelled', reservedBy: null })
    page.history = []
    expect(html).toContain(cs.history.title)
    expect(html).toContain('so 21. 11. 10:12 · Táta: zrušeno')
    expect(html).toContain('„Udělá to firma.“')
    expect(html).not.toContain(cs.cancelTask.action)
  })
})
