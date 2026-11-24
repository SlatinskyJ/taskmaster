import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ButtonModule from '~/components/ui/button'
import { cs } from '~/lib/strings'
import {
  approveTaskScoreChangeFn,
  cancelTaskFn,
  declineTaskScoreChangeFn,
  proposeTaskScoreChangeFn,
  type TaskView,
} from '~/server/tasks/functions'
import { CancelForm, canCancel, cancelData } from './CancelTask'
import { ProposeForm, ScoreChangePanel } from './ScoreChangePanel'

// The price panel and the cancel form (#36), rendered statically. As in workButtons.test.tsx,
// the action hook and server functions are stubbed and Button records each label's handler.
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
  approveTaskScoreChangeFn: vi.fn(),
  declineTaskScoreChangeFn: vi.fn(),
  proposeTaskScoreChangeFn: vi.fn(),
  cancelTaskFn: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))

const TATA = { id: 2, role: 'giver' } as const
const STARSI = { id: 3, role: 'taker' } as const
const MLADSI = { id: 4, role: 'taker' } as const
const pending: TaskView = {
  id: 1,
  title: 'Vyluxovat celý obývák a chodbu',
  status: 'open',
  score: 18,
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
  origin: 'one_time',
  templateId: null,
  dueAt: null,
  graceEndsAt: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  waitingFor: [],
  scoreChange: {
    id: 7,
    score: 20,
    proposedBy: { id: 2, name: 'Táta' },
    approvedBy: [{ id: 2, name: 'Táta' }],
    waitingFor: [
      { id: 3, name: 'Starší' },
      { id: 4, name: 'Mladší' },
    ],
  },
}

type RunArgs = [string, () => unknown, (r: unknown) => string, unknown]
const lastRun = () => action.run.mock.lastCall as unknown as RunArgs

beforeEach(() => {
  action.busy = null
  action.run.mockReset()
  action.run.mockResolvedValue(true)
  action.pressed.clear()
  vi.mocked(approveTaskScoreChangeFn).mockReset()
  vi.mocked(declineTaskScoreChangeFn).mockReset()
})

describe('a proposal in flight', () => {
  it('Mladší sees the old and new price, who agreed, both buttons and the hint', () => {
    const html = renderToStaticMarkup(<ScoreChangePanel task={pending} me={MLADSI} />)
    expect(html).toContain('18 b')
    expect(html).toContain('20 b')
    expect(html).toContain('Souhlasí: Táta ✓')
    expect(html).toContain('Čeká se na: Starší nebo tebe')
    expect(html).toContain(cs.taskPrice.disagreeHint(18))
    expect(html).toContain('grid-cols-2')
  })

  it('Souhlasím approves this change, never declines it', () => {
    renderToStaticMarkup(<ScoreChangePanel task={pending} me={MLADSI} />)
    action.pressed.get(cs.taskPrice.agree)?.onClick?.({})
    const [key, fn, success] = lastRun()
    void fn()
    expect(key).toBe('price-yes-7')
    expect(approveTaskScoreChangeFn).toHaveBeenCalledWith({ data: { taskId: 1, changeId: 7 } })
    expect(declineTaskScoreChangeFn).not.toHaveBeenCalled()
    expect(success({ ok: true })).toBe(cs.taskPrice.toast.approved)
  })

  it('Nesouhlasím declines this change, never approves it', () => {
    renderToStaticMarkup(<ScoreChangePanel task={pending} me={MLADSI} />)
    action.pressed.get(cs.taskPrice.disagree)?.onClick?.({})
    const [, fn, success] = lastRun()
    void fn()
    expect(declineTaskScoreChangeFn).toHaveBeenCalledWith({ data: { taskId: 1, changeId: 7 } })
    expect(approveTaskScoreChangeFn).not.toHaveBeenCalled()
    expect(success({ ok: true })).toBe(cs.taskPrice.toast.declined)
  })

  it('the proposer only gets Stáhnout návrh, which declines', () => {
    const html = renderToStaticMarkup(<ScoreChangePanel task={pending} me={TATA} />)
    expect(html).toContain('Souhlasí: ty ✓')
    expect(html).not.toContain(`>${cs.taskPrice.agree}<`)
    expect(html).not.toContain(`>${cs.taskPrice.disagree}<`)
    action.pressed.get(cs.taskPrice.withdraw)?.onClick?.({})
    const [, fn, success] = lastRun()
    void fn()
    expect(declineTaskScoreChangeFn).toHaveBeenCalledWith({ data: { taskId: 1, changeId: 7 } })
    expect(approveTaskScoreChangeFn).not.toHaveBeenCalled()
    expect(success({ ok: true })).toBe(cs.taskPrice.toast.withdrawn)
  })

  it('someone it does not wait for sees it but cannot answer', () => {
    const notMine = {
      ...pending,
      scoreChange: pending.scoreChange && {
        ...pending.scoreChange,
        waitingFor: [{ id: 3, name: 'Starší' }],
      },
    }
    const html = renderToStaticMarkup(<ScoreChangePanel task={notMine} me={MLADSI} />)
    expect(html).toContain(cs.taskPrice.pending)
    expect(html).not.toContain(`>${cs.taskPrice.agree}<`)
    expect(html).not.toContain(`>${cs.taskPrice.disagree}<`)
  })

  it('while busy the buttons are disabled', () => {
    action.busy = 'price-yes-7'
    renderToStaticMarkup(<ScoreChangePanel task={pending} me={MLADSI} />)
    expect(action.pressed.get(cs.taskPrice.agree)?.disabled).toBe(true)
    expect(action.pressed.get(cs.taskPrice.disagree)?.disabled).toBe(true)
  })
})

describe('proposing', () => {
  it('Změnit cenu for a parent on an open task, nothing for a finished one', () => {
    const open = { ...pending, scoreChange: null }
    expect(renderToStaticMarkup(<ScoreChangePanel task={open} me={TATA} />)).toContain(
      cs.taskPrice.needsOpen,
    )
    expect(
      renderToStaticMarkup(
        <ScoreChangePanel task={{ ...open, status: 'confirmed' }} me={STARSI} />,
      ),
    ).toBe('')
  })

  it('the send button waits for a different number and sends it', () => {
    const onDone = vi.fn()
    renderToStaticMarkup(
      <ProposeForm task={{ id: 1, score: 18 }} busy={null} run={action.run} onDone={onDone} />,
    )
    expect(action.pressed.get(cs.taskPrice.send(18))?.disabled).toBe(true)
  })

  it('one up it sends { taskId, score: 19 } and closes on success', async () => {
    const onDone = vi.fn()
    renderToStaticMarkup(
      <ProposeForm
        task={{ id: 1, score: 18 }}
        start={19}
        busy={null}
        run={action.run}
        onDone={onDone}
      />,
    )
    const send = action.pressed.get(cs.taskPrice.send(19))
    expect(send?.disabled).toBe(false)
    send?.onClick?.({})
    const [key, fn, success] = lastRun()
    expect(key).toBe('price-1')
    void fn()
    expect(proposeTaskScoreChangeFn).toHaveBeenCalledWith({ data: { taskId: 1, score: 19 } })
    expect(success({ ok: true })).toBe(cs.taskPrice.toast.proposed)
    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1)
    })
  })

  it('stops at 999', () => {
    const html = renderToStaticMarkup(
      <ProposeForm
        task={{ id: 1, score: 18 }}
        start={999}
        busy={null}
        run={action.run}
        onDone={vi.fn()}
      />,
    )
    expect(html).toContain(cs.taskPrice.send(999))
    expect(action.pressed.get(cs.taskPrice.send(999))?.disabled).toBe(false)
  })
})

describe('cancel form', () => {
  it('has the reason field (200 max), Zpět and Zrušit úkol, disabled while busy', () => {
    const html = renderToStaticMarkup(
      <CancelForm task={{ id: 1 }} busy="cancel-1" run={action.run} onDone={vi.fn()} />,
    )
    expect(html).toContain(cs.cancelTask.reason)
    expect(html).toContain('maxLength="200"')
    expect(action.pressed.get(cs.cancelTask.confirm)?.disabled).toBe(true)
    expect(html).toContain('aria-busy="true"')
  })

  it('sends the trimmed reason, or none when blank', () => {
    expect(cancelData(1, '  Už to udělala máma. ')).toEqual({
      taskId: 1,
      reason: 'Už to udělala máma.',
    })
    expect(cancelData(1, '   ')).toEqual({ taskId: 1 })
    expect(cancelTaskFn).not.toHaveBeenCalled()
  })
})

describe('who sees Zrušit úkol', () => {
  it('a giver, on a task not yet done: proposed, open, reserved', () => {
    const table = [
      ['proposed', true],
      ['open', true],
      ['reserved', true],
      ['done_unconfirmed', false],
      ['confirmed', false],
      ['cancelled', false],
    ] as const
    for (const [status, giver] of table) {
      expect([status, canCancel({ status }, TATA)]).toEqual([status, giver])
      expect([status, canCancel({ status }, STARSI)]).toEqual([status, false])
      expect([status, canCancel({ status }, { id: 1, role: 'admin' })]).toEqual([status, false])
    }
  })
})
