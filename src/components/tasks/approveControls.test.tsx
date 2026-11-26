import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { approveTaskFn, rejectTaskFn, type TaskView } from '~/server/tasks/functions'
import {
  ApprovableRow,
  ApproveIcons,
  ApprovePanel,
  ApproveWide,
  submitReject,
} from './ApproveControls'

// The approve controls (#206): what each button sends, and the reject form's submit. Rendered
// statically; the server functions and the router are mocks.
const action = vi.hoisted(() => ({ busy: null as string | null, run: vi.fn() }))
vi.mock('./useTaskAction', () => ({
  useTaskAction: () => ({ busy: action.busy, run: action.run }),
}))
vi.mock('~/server/tasks/functions', () => ({
  approveTaskFn: vi.fn(),
  rejectTaskFn: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))

const done: TaskView = {
  id: 7,
  title: 'Vyluxovat celý obývák a chodbu',
  description: null,
  status: 'done_unconfirmed',
  score: 8,
  approvalRequired: true,
  createdByName: 'Táta',
  offeredByName: null,
  approvedBy: [],
  approverIds: [],
  bids: [],
  lastBids: [],
  lowest: null,
  reservedBy: { id: 3, name: 'Starší' },
  completedBy: { id: 3, name: 'Starší' },
  completedAt: '2026-11-18T14:00:00.000Z',
  earnerId: 3,
  origin: 'one_time',
  templateId: null,
  dueAt: null,
  graceEndsAt: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  waitingFor: [],
  scoreChange: null,
  rebidding: null,
}
const TATA = { id: 2, role: 'giver' } as const
const STARSI = { id: 3, role: 'taker' } as const

/** Finds the button(s) with this aria-label or this text in an unrendered element tree. */
function findButton(node: unknown, name: string): { onClick: (e: unknown) => void } {
  const found: { onClick: (e: unknown) => void }[] = []
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    if (n === null || typeof n !== 'object' || !('props' in n)) return
    const props = (n as { props: Record<string, unknown> }).props
    const type = (n as { type?: unknown }).type
    if (typeof type === 'function') {
      walk((type as (p: unknown) => unknown)(props))
      return
    }
    if (
      typeof props.onClick === 'function' &&
      (props['aria-label'] === name || props.children === name)
    )
      found.push(props as unknown as { onClick: (e: unknown) => void })
    Object.values(props).forEach(walk)
  }
  walk(node)
  if (found.length !== 1) throw new Error(`expected one "${name}", got ${String(found.length)}`)
  return found[0] as { onClick: (e: unknown) => void }
}

const click = { currentTarget: {} }

beforeEach(() => {
  action.busy = null
  action.run.mockReset()
  vi.mocked(approveTaskFn).mockClear()
  vi.mocked(rejectTaskFn).mockClear()
})

async function lastCall() {
  expect(action.run).toHaveBeenCalledTimes(1)
  const [key, call] = action.run.mock.calls[0] as [string, () => Promise<unknown>]
  await call()
  return key
}

describe('approve buttons send approve for their own task (#206)', () => {
  it('the row’s ✓ approves task 7, never rejects', async () => {
    const tree = ApproveIcons({ task: done, busy: null, run: action.run, onReject: vi.fn() })
    findButton(tree, cs.work.approve).onClick(click)
    expect(await lastCall()).toBe('approve-7')
    expect(approveTaskFn).toHaveBeenCalledWith({ data: { taskId: 7 } })
    expect(rejectTaskFn).not.toHaveBeenCalled()
  })

  it('the page’s Schválit approves task 7, never rejects', async () => {
    const tree = ApproveWide({ task: done, busy: null, run: action.run, onReject: vi.fn() })
    findButton(tree, cs.work.approve).onClick(click)
    expect(await lastCall()).toBe('approve-7')
    expect(approveTaskFn).toHaveBeenCalledWith({ data: { taskId: 7 } })
    expect(rejectTaskFn).not.toHaveBeenCalled()
  })

  it('Zamítnout only opens the form; nothing is sent', () => {
    for (const C of [ApproveIcons, ApproveWide]) {
      const onReject = vi.fn()
      findButton(C({ task: done, busy: null, run: action.run, onReject }), cs.work.reject).onClick(
        click,
      )
      expect(onReject).toHaveBeenCalledTimes(1)
    }
    expect(action.run).not.toHaveBeenCalled()
  })
})

describe('submitReject', () => {
  it('a blank reason is none; a reason is trimmed', async () => {
    action.run.mockResolvedValue(true)
    await submitReject(7, '   ', action.run, vi.fn())
    await submitReject(7, ' špatně ', action.run, vi.fn())
    for (const [, call] of action.run.mock.calls as [string, () => Promise<unknown>][]) await call()
    expect(rejectTaskFn).toHaveBeenNthCalledWith(1, { data: { taskId: 7, reason: undefined } })
    expect(rejectTaskFn).toHaveBeenNthCalledWith(2, { data: { taskId: 7, reason: 'špatně' } })
    expect(action.run.mock.calls[0]?.[0]).toBe('reject-7')
  })

  it('closes the form only when the reject went through', async () => {
    const onClose = vi.fn()
    action.run.mockResolvedValueOnce(false)
    await submitReject(7, 'ještě chodba', action.run, onClose)
    expect(onClose).not.toHaveBeenCalled()
    action.run.mockResolvedValueOnce(true)
    await submitReject(7, 'ještě chodba', action.run, onClose)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ApprovableRow and ApprovePanel', () => {
  it('the row: name, who did it, ✕ and ✓ as icons, no reason field yet', () => {
    const html = renderToStaticMarkup(<ApprovableRow task={done} busy={null} run={action.run} />)
    expect(html).toContain('Vyluxovat celý obývák a chodbu')
    expect(html).toContain(`${cs.work.doneBy} Starší`)
    expect(html).toContain(`aria-label="${cs.work.approve}"`)
    expect(html).toContain(`aria-label="${cs.work.reject}"`)
    expect(html).not.toContain('name="reason"')
  })

  it('the page: two full-width buttons for a parent on done work, nothing otherwise', () => {
    const html = renderToStaticMarkup(<ApprovePanel task={done} me={TATA} />)
    expect(html).toMatch(new RegExp(`<button[^>]*w-full[^>]*>${cs.work.approve}</button>`))
    expect(html).toMatch(new RegExp(`<button[^>]*w-full[^>]*>${cs.work.reject}</button>`))
    expect(renderToStaticMarkup(<ApprovePanel task={done} me={STARSI} />)).toBe('')
    expect(
      renderToStaticMarkup(<ApprovePanel task={{ ...done, status: 'reserved' }} me={TATA} />),
    ).toBe('')
  })
})
