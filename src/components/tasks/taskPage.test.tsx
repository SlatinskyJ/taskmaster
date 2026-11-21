import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'

// The task page itself (#150), rendered statically through its route: the router hands the page
// the test's user and task. Lives here, not in src/routes, because the router generator treats
// every file there as a route.
interface PageUser {
  id: number
  role: 'taker' | 'giver'
  displayName: string
}
const page = vi.hoisted(() => {
  const state: { user: PageUser | null; task: TaskView | null } = { user: null, task: null }
  return state
})
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ user: page.user }),
    useLoaderData: () => ({ task: page.task, thread: [] }),
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
  waitingFor: [],
}

function render(user: PageUser) {
  page.user = user
  page.task = reserved
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
