import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ButtonModule from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { completeTaskFn, releaseTaskFn, type TaskView } from '~/server/tasks/functions'
import { TakerBoard } from './TakerBoard'
import { TaskWorkPanel } from './WorkButtons'

// Hotovo and Uvolnit (#150), on the task page and the Domů row, rendered statically. The action
// hook and the server functions are stubbed as in bidPanel.test.tsx; Button records each label's
// click handler and disabled flag so a test can press it.
const action = vi.hoisted(() => ({
  busy: null as string | null,
  run: vi.fn(),
  pressed: new Map<string, { onClick?: (e: unknown) => void; disabled?: boolean }>(),
}))
vi.mock('./useTaskAction', () => ({
  useTaskAction: () => ({ busy: action.busy, run: action.run }),
}))
vi.mock('~/components/ui/button', async (original) => {
  const real = await original<typeof ButtonModule>()
  return {
    ...real,
    Button: (props: Parameters<typeof real.Button>[0]) => {
      if (typeof props.children === 'string') {
        action.pressed.set(props.children, {
          onClick: props.onClick as ((e: unknown) => void) | undefined,
          disabled: props.disabled,
        })
      }
      return real.Button(props)
    },
  }
})
vi.mock('~/server/tasks/functions', () => ({
  completeTaskFn: vi.fn(),
  releaseTaskFn: vi.fn(),
  reserveTaskFn: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))

const STARSI = { id: 3, role: 'taker' } as const
const MLADSI = { id: 4, role: 'taker' } as const
const TATA = { id: 2, role: 'giver' } as const
const view = (over: Partial<TaskView>): TaskView => ({
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
  ...over,
})

type Run = [string, () => unknown, (r: { ok: true; status: string }) => string, unknown?]
const lastRun = () => action.run.mock.calls.at(-1) as Run
const count = (html: string, s: string) => html.split(s).length - 1

beforeEach(() => {
  action.busy = null
  action.run.mockReset()
  action.pressed.clear()
  vi.mocked(completeTaskFn).mockReset()
  vi.mocked(releaseTaskFn).mockReset()
})

describe('TaskWorkPanel (task page)', () => {
  it('the reserver sees Hotovo, then Uvolnit under it, both full width', () => {
    const html = renderToStaticMarkup(<TaskWorkPanel task={view({})} me={STARSI} />)
    expect(html.indexOf(cs.work.done)).toBeGreaterThan(-1)
    expect(html.indexOf(cs.work.done)).toBeLessThan(html.indexOf(cs.work.release))
    expect(html).toMatch(/class="grid gap-2"/)
    expect(count(html, 'w-full')).toBe(2)
  })

  it('nobody else sees them', () => {
    for (const [task, me] of [
      [view({}), MLADSI],
      [view({}), TATA],
      [view({ status: 'open', reservedBy: null }), STARSI],
    ] as const) {
      expect(renderToStaticMarkup(<TaskWorkPanel task={task} me={me} />)).toBe('')
    }
  })

  it('Hotovo sends this task to completeTaskFn with confetti, toast by status', () => {
    renderToStaticMarkup(<TaskWorkPanel task={view({})} me={STARSI} />)
    const el = { tag: 'button' }
    action.pressed.get(cs.work.done)?.onClick?.({ currentTarget: el })
    const [key, fn, success, opts] = lastRun()
    expect(key).toBe('done-1')
    expect(opts).toEqual({ confetti: el })
    void fn()
    expect(completeTaskFn).toHaveBeenCalledWith({ data: { taskId: 1 } })
    expect(success({ ok: true, status: 'confirmed' })).toBe(cs.work.toast.done)
    expect(success({ ok: true, status: 'done_unconfirmed' })).toBe(cs.work.toast.pending)
  })

  it('Uvolnit sends this task to releaseTaskFn', () => {
    renderToStaticMarkup(<TaskWorkPanel task={view({})} me={STARSI} />)
    action.pressed.get(cs.work.release)?.onClick?.({ currentTarget: null })
    const [key, fn, success] = lastRun()
    expect(key).toBe('release-1')
    void fn()
    expect(releaseTaskFn).toHaveBeenCalledWith({ data: { taskId: 1 } })
    expect(success({ ok: true, status: 'open' })).toBe(cs.work.toast.released)
  })

  it('while busy both are disabled and the tapped one is aria-busy', () => {
    action.busy = 'release-1'
    const html = renderToStaticMarkup(<TaskWorkPanel task={view({})} me={STARSI} />)
    expect(action.pressed.get(cs.work.done)?.disabled).toBe(true)
    expect(action.pressed.get(cs.work.release)?.disabled).toBe(true)
    expect(count(html, 'aria-busy="true"')).toBe(1)
  })
})

describe('TakerBoard Moje row (Domů)', () => {
  it('Domů Moje row keeps Uvolnit then Hotovo, compact, disabled while anything on the board runs', () => {
    action.busy = 'reserve-9'
    const pending = view({
      id: 2,
      title: 'Vynést koše',
      status: 'done_unconfirmed',
      reservedBy: null,
      earnerId: 3,
    })
    const html = renderToStaticMarkup(<TakerBoard items={[view({}), pending]} me={3} />)
    expect(html.indexOf(cs.work.release)).toBeLessThan(html.indexOf(cs.work.done))
    expect(html).toMatch(/class="flex gap-1.5"/)
    expect(action.pressed.get(cs.work.release)?.disabled).toBe(true)
    expect(action.pressed.get(cs.work.done)?.disabled).toBe(true)
    expect(count(html, 'aria-busy="false"')).toBe(2)
    // The done-and-waiting row is the pending row, with no buttons of its own.
    expect(count(html, `>${cs.work.done}<`)).toBe(1)
    expect(count(html, `>${cs.work.release}<`)).toBe(1)
    expect(html).toContain('Vynést koše')
    action.pressed.get(cs.work.release)?.onClick?.({ currentTarget: null })
    expect(lastRun()[0]).toBe('release-1')
  })
})
