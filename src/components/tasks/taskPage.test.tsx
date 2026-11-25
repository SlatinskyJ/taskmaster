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
  const state: {
    user: PageUser | null
    task: TaskView | null
    history: HistoryEntry[]
    disputes: boolean
    reopen: boolean
    approveAnywhere: boolean
    marks: Record<string, unknown>
  } = {
    user: null,
    task: null,
    history: [],
    disputes: false,
    reopen: false,
    approveAnywhere: false,
    marks: {},
  }
  return state
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({
      user: page.user,
      features: {
        disputes: page.disputes,
        reopenBidding: page.reopen,
        bidRefusals: true,
        approveAnywhere: page.approveAnywhere,
      },
    }),
    useLoaderData: () => ({
      task: page.task,
      thread: [],
      history: page.history,
      disputeMarks: page.marks,
    }),
  }),
  notFound: () => new Error('not found'),
  redirect: vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('./useTaskAction', () => ({ useTaskAction: () => ({ busy: null, run: vi.fn() }) }))
vi.mock('./bidCalls', () => ({ callBid: vi.fn(), BID_CALLS: {} }))
vi.mock('~/server/tasks/functions', () => ({
  getTaskDetailFn: vi.fn(() => Promise.resolve({ task: page.task, thread: [], history: [] })),
}))
vi.mock('~/server/disputes/functions', () => ({
  getItemMarkFn: vi.fn(() => Promise.resolve(null)),
  openDisputeFn: vi.fn(),
}))

const { Route } = await import('~/routes/_app/ukol/$taskId')
const { getItemMarkFn } = await import('~/server/disputes/functions')

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
  lastBids: [],
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
  rebidding: null,
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

describe('task page: Schválit and Zamítnout (#206)', () => {
  const TATA = { id: 2, role: 'giver', displayName: 'Táta' } as const
  const STARSI = { id: 3, role: 'taker', displayName: 'Starší' } as const
  const done: TaskView = {
    ...reserved,
    status: 'done_unconfirmed',
    completedBy: { id: 3, name: 'Starší' },
    earnerId: 3,
  }
  const shows = (html: string) =>
    html.includes(`>${cs.work.approve}<`) && html.includes(`>${cs.work.reject}<`)

  it('switch on: a parent on done work gets both; the brother who did it gets neither', () => {
    page.approveAnywhere = true
    expect(shows(render(TATA, done))).toBe(true)
    expect(render(STARSI, done)).not.toContain(`>${cs.work.approve}<`)
    expect(shows(render(TATA, reserved))).toBe(false)
    page.approveAnywhere = false
  })

  it('switch off: no Schválit on the page, as before', () => {
    page.approveAnywhere = false
    expect(render(TATA, done)).not.toContain(`>${cs.work.approve}<`)
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

describe('task page: Rozporovat (#46)', () => {
  const TATA = { id: 2, role: 'giver', displayName: 'Táta' } as const
  const confirmed: TaskView = {
    ...reserved,
    status: 'confirmed',
    completedBy: { id: 3, name: 'Starší' },
    completedAt: '2026-11-21T09:00:00.000Z',
    earnerId: 3,
  }
  type Loader = (a: {
    params: { taskId: string }
    context: { features: { disputes: boolean } }
  }) => Promise<{ disputeMarks: Record<string, unknown> }>
  const load = (task: TaskView, disputes: boolean) => {
    page.task = task
    vi.mocked(getItemMarkFn).mockClear()
    return (Route as unknown as { loader: Loader }).loader({
      params: { taskId: String(task.id) },
      context: { features: { disputes } },
    })
  }
  const on = (task: TaskView) => {
    page.disputes = true
    const html = render(TATA, task)
    page.disputes = false
    return html
  }

  it('loader, switch on: an agreed task reads its score mark, a confirmed one also its completion', async () => {
    expect((await load(reserved, true)).disputeMarks).toEqual({ task_score: null })
    expect(vi.mocked(getItemMarkFn).mock.calls).toEqual([[{ data: { kind: 'task_score', id: 1 } }]])
    await load(confirmed, true)
    expect(vi.mocked(getItemMarkFn).mock.calls).toEqual([
      [{ data: { kind: 'task_score', id: 1 } }],
      [{ data: { kind: 'completion', id: 1 } }],
    ])
  })

  it('loader: switch off or a proposed task reads nothing', async () => {
    expect((await load(confirmed, false)).disputeMarks).toEqual({})
    await load({ ...reserved, status: 'proposed' }, true)
    expect(getItemMarkFn).not.toHaveBeenCalled()
  })

  it('an agreed task: Rozporovat on the score, led by Body za úkol', () => {
    const html = on(reserved)
    expect(html).toContain('aria-label="Rozporovat: Body za úkol – Vyluxovat celý obývák a chodbu"')
    expect(html).toContain(`>${cs.disputes.what.task_score}<`)
    expect(html).not.toContain(cs.disputes.what.completion)
  })

  it('a confirmed task: also on the completion, each line with its own lead and name', () => {
    const html = on(confirmed)
    expect(html.split('data-slot="dispute"')).toHaveLength(3)
    expect(html).toContain(`>${cs.disputes.what.completion}<`)
    expect(html).toContain(
      'aria-label="Rozporovat: Potvrzené splnění – Vyluxovat celý obývák a chodbu"',
    )
  })

  it('an open dispute on the score: Sporné next to its lead, no button there', () => {
    page.marks = { task_score: { status: 'open' } }
    const html = on(reserved)
    page.marks = {}
    expect(html).toContain(cs.disputes.waiting)
    expect(html).not.toContain(`>${cs.disputes.action}<`)
  })

  it('proposed, or the switch off: none', () => {
    expect(on({ ...reserved, status: 'proposed' })).not.toContain('data-slot="dispute"')
    expect(render(TATA, confirmed)).not.toContain('data-slot="dispute"')
  })
})

describe('task page: reopened bidding (#212)', () => {
  const TATA = { id: 2, role: 'giver', displayName: 'Táta' } as const
  const STARSI = { id: 3, role: 'taker', displayName: 'Starší' } as const
  const free: TaskView = {
    ...reserved,
    status: 'open',
    score: 18,
    reservedBy: null,
    approvedBy: [],
    approverIds: [],
  }
  const round = (offeredBy: { id: number; name: string } | null, offer = 18): TaskView => ({
    ...free,
    rebidding: { offer, offeredBy },
  })

  it('switch on: a free task offers Vyjednat novou cenu with its hint, not Změnit cenu', () => {
    page.reopen = true
    const html = render(STARSI, free)
    expect(html).toContain(cs.rebid.reopen)
    expect(html).toContain(cs.rebid.reopenHint(18))
    expect(html).not.toContain(cs.taskPrice.change)
    page.reopen = false
  })
  it('switch off: no reopen button, Změnit cenu as before', () => {
    const html = render(STARSI, free)
    expect(html).not.toContain(cs.rebid.reopen)
    expect(html).toContain(cs.taskPrice.change)
  })
  it('a fresh round: the agreed score still applies, no entries yet, no Souhlasím', () => {
    page.reopen = true
    const html = render(STARSI, round(null))
    expect(html).toContain(cs.taskPrice.oldStays(18))
    expect(html).toContain(cs.rebid.noEntries)
    expect(html).not.toContain(cs.rebid.reopen)
    expect(html).not.toContain(`>${cs.tasks.approve}<`)
    expect(html).toContain(cs.state.negotiating)
    page.reopen = false
  })
  it('a counter: the header names it, Souhlasím says the new price', () => {
    const html = render(STARSI, round({ id: 2, name: 'Táta' }, 16))
    expect(html).toContain('Táta nabízí 16 b')
    expect(html).toContain(`>${cs.tasks.approve}<`)
    expect(html).toContain(cs.rebid.approveHint(16))
  })
  it('a parent in a round with no bids gets no turn-down (Jakub 2026-11-25)', () => {
    const html = render(TATA, round(null))
    expect(html).not.toContain(cs.bids.turnDown)
    expect(html).toContain(cs.rebid.noEntries)
  })
})
