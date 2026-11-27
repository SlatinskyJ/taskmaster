import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ButtonModule from '~/components/ui/button'
import { cs } from '~/lib/strings'
import {
  completeTaskFn,
  releaseTaskFn,
  reserveTaskFn,
  type TaskView,
} from '~/server/tasks/functions'
import { TakerBoard } from './TakerBoard'
import { ToApprove } from './ToApprove'
import { pointsFloat } from './pointsFloat'
import { DoneButton, TaskWorkPanel } from './WorkButtons'

// Hotovo and Uvolnit (#150), on the task page and the Domů row, rendered statically. The action
// hook and the server functions are stubbed as in bidPanel.test.tsx; Button records each label's
// (or icon button's aria-label's) click handler and disabled flag so a test can press it.
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
      // An icon button (Uvolnit on a row, #148) is recorded by its aria-label.
      const name = typeof props.children === 'string' ? props.children : props['aria-label']
      if (name !== undefined) {
        action.pressed.set(name, {
          onClick: props.onClick as ((e: unknown) => void) | undefined,
          disabled: props.disabled,
        })
      }
      return real.Button(props)
    },
  }
})
vi.mock('~/server/tasks/functions', () => ({
  approveTaskFn: vi.fn(),
  rejectTaskFn: vi.fn(),
  completeTaskFn: vi.fn(),
  releaseTaskFn: vi.fn(),
  reserveTaskFn: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  // A plain anchor with the route's real path, so a row's link can be checked.
  Link: ({
    params,
    children,
    className,
  }: {
    params: { taskId: string }
    children: ReactNode
    className?: string
  }) => (
    <a href={`/ukol/${params.taskId}`} className={className}>
      {children}
    </a>
  ),
}))

const STARSI = { id: 3, role: 'taker' } as const
const MLADSI = { id: 4, role: 'taker' } as const
const TATA = { id: 2, role: 'giver' } as const
const view = (over: Partial<TaskView>): TaskView => ({
  planDay: null,
  id: 1,
  title: 'Vyluxovat celý obývák a chodbu',
  description: null,
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
  vi.mocked(reserveTaskFn).mockReset()
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
      // A free task: Rezervovat is a brother's (#195), never a parent's.
      [view({ status: 'open', reservedBy: null }), TATA],
      [view({ status: 'proposed', reservedBy: null }), STARSI],
      [view({ status: 'done_unconfirmed' }), STARSI],
    ] as const) {
      expect(renderToStaticMarkup(<TaskWorkPanel task={task} me={me} />)).toBe('')
    }
  })

  it('a brother on a free task: the hint, Rezervovat, then Hotovo, full width (#195)', () => {
    const html = renderToStaticMarkup(
      <TaskWorkPanel task={view({ status: 'open', reservedBy: null })} me={STARSI} />,
    )
    const at = (s: string) => html.indexOf(s)
    expect(at(cs.work.reserveHint)).toBeGreaterThan(-1)
    expect(at(cs.work.reserveHint)).toBeLessThan(at(`>${cs.work.reserve}<`))
    expect(at(`>${cs.work.reserve}<`)).toBeLessThan(at(`>${cs.work.done}<`))
    expect(html).not.toContain(cs.work.release)
    expect(count(html, 'w-full')).toBe(2)
  })

  it('Rezervovat on the page reserves this task, toast reserved', () => {
    renderToStaticMarkup(
      <TaskWorkPanel task={view({ status: 'open', reservedBy: null })} me={STARSI} />,
    )
    action.pressed.get(cs.work.reserve)?.onClick?.({})
    const [key, fn, success] = lastRun()
    expect(key).toBe('reserve-1')
    void fn()
    expect(reserveTaskFn).toHaveBeenCalledWith({ data: { taskId: 1 } })
    expect(success({ ok: true, status: 'reserved' })).toBe(cs.work.toast.reserved)
  })

  it('Hotovo sends this task to completeTaskFn with confetti, toast by status', () => {
    renderToStaticMarkup(<TaskWorkPanel task={view({})} me={STARSI} />)
    const el = { tag: 'button' }
    action.pressed.get(cs.work.done)?.onClick?.({ currentTarget: el })
    const [key, fn, success, opts] = lastRun()
    expect(key).toBe('done-1')
    expect(opts).toEqual({ confetti: el, float: 8 })
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
    expect(html).toMatch(/class="flex gap-2"/)
    expect(action.pressed.get(cs.work.release)?.disabled).toBe(true)
    expect(action.pressed.get(cs.work.done)?.disabled).toBe(true)
    expect(count(html, 'aria-busy="false"')).toBe(2)
    // The done-and-waiting row is the pending row, with no buttons of its own.
    expect(count(html, `>${cs.work.done}<`)).toBe(1)
    // Uvolnit is an icon button on the row (#148): named by aria-label, no visible text.
    expect(count(html, `aria-label="${cs.work.release}"`)).toBe(1)
    expect(count(html, `>${cs.work.release}<`)).toBe(0)
    expect(html).toContain('Vynést koše')
    action.pressed.get(cs.work.release)?.onClick?.({ currentTarget: null })
    expect(lastRun()[0]).toBe('release-1')
  })
})

describe("TakerBoard Moje: the other brother's tasks stay out (#170)", () => {
  // The slice of the board under Moje, up to Volné.
  const mineSection = (html: string) => {
    const start = html.indexOf('aria-labelledby="mine-label"')
    return start < 0 ? '' : html.slice(start, html.indexOf('aria-labelledby="free-label"'))
  }
  const hisReserved = view({
    id: 11,
    title: 'Jeho rezervovaný',
    reservedBy: { id: 4, name: 'Mladší' },
  })
  const hisDone = view({
    id: 12,
    title: 'Jeho hotový',
    status: 'done_unconfirmed',
    reservedBy: null,
    completedBy: { id: 4, name: 'Mladší' },
    earnerId: 4,
  })
  const myConfirmed = view({
    id: 13,
    title: 'Můj potvrzený',
    status: 'confirmed',
    reservedBy: null,
    completedBy: { id: 3, name: 'Starší' },
    earnerId: 3,
  })
  const myDone = view({
    id: 14,
    title: 'Můj čekající',
    status: 'done_unconfirmed',
    reservedBy: null,
    completedBy: { id: 3, name: 'Starší' },
    earnerId: 3,
  })

  it('a task the other brother reserved or did is not under Moje, nor one of mine already confirmed', () => {
    const html = renderToStaticMarkup(
      <TakerBoard items={[hisReserved, hisDone, myConfirmed, myDone]} me={3} />,
    )
    const mine = mineSection(html)
    expect(mine).toContain('Můj čekající')
    expect(mine).not.toContain('Jeho rezervovaný')
    expect(mine).not.toContain('Jeho hotový')
    expect(mine).not.toContain('Můj potvrzený')
  })

  it('with only the other brother’s tasks there is no Moje at all', () => {
    const html = renderToStaticMarkup(<TakerBoard items={[hisReserved, hisDone]} me={3} />)
    expect(html).not.toContain('mine-label')
    expect(html).not.toContain(cs.work.mine)
    // For him the same tasks are his.
    const his = mineSection(
      renderToStaticMarkup(<TakerBoard items={[hisReserved, hisDone]} me={4} />),
    )
    expect(his).toContain('Jeho rezervovaný')
    expect(his).toContain('Jeho hotový')
  })
})

describe("TakerBoard: a later day's copy (#257)", () => {
  // Thursday 1 January 2099 in Prague: always a later day.
  const later = view({
    id: 5,
    origin: 'scheduled',
    templateId: 9,
    planDay: '2098-12-31T23:00:00.000Z',
  })

  it("Domů: a later reserved copy shows 'Čt' and Uvolnit, no Hotovo", () => {
    const html = renderToStaticMarkup(<TakerBoard items={[later]} me={3} />)
    expect(html).toContain('Vyluxovat celý obývák a chodbu')
    expect(html).toContain('>Čt<')
    expect(count(html, `aria-label="${cs.work.release}"`)).toBe(1)
    expect(html).not.toContain(`>${cs.work.done}<`)
  })

  it("today's reserved copy keeps Hotovo", () => {
    const today = view({ id: 6, planDay: '2026-11-25T23:00:00.000Z' })
    const html = renderToStaticMarkup(<TakerBoard items={[today]} me={3} />)
    expect(html).toContain(`>${cs.work.done}<`)
  })

  it('the task page: a later copy reserved by him shows Uvolnit but no Hotovo', () => {
    const html = renderToStaticMarkup(<TaskWorkPanel task={later} me={STARSI} />)
    expect(html).toContain(`>${cs.work.release}<`)
    expect(html).not.toContain(`>${cs.work.done}<`)
  })
})

describe('TakerBoard Volné row (Domů, #40)', () => {
  const open = view({
    id: 7,
    title: 'Umýt okna v obýváku i v ložnici',
    status: 'open',
    reservedBy: null,
  })

  it('an open row has icon Rezervovat, then Hotovo, both 44 px', () => {
    const html = renderToStaticMarkup(<TakerBoard items={[open]} me={3} />)
    expect(html).toContain('Umýt okna v obýváku i v ložnici')
    expect(count(html, `aria-label="${cs.work.reserve}"`)).toBe(1)
    expect(count(html, `>${cs.work.reserve}<`)).toBe(0)
    expect(html.indexOf(`aria-label="${cs.work.reserve}"`)).toBeLessThan(
      html.indexOf(`>${cs.work.done}<`),
    )
    expect(html).toMatch(
      new RegExp(
        `aria-label="${cs.work.reserve}"[^>]*title="${cs.work.reserve}"|title="${cs.work.reserve}"[^>]*aria-label="${cs.work.reserve}"`,
      ),
    )
    expect(html).toContain('size-tap')
  })

  it('Rezervovat reserves, it does not complete', () => {
    renderToStaticMarkup(<TakerBoard items={[open]} me={3} />)
    action.pressed.get(cs.work.reserve)?.onClick?.({ currentTarget: null })
    const [key, fn, success] = lastRun()
    expect(key).toBe('reserve-7')
    void fn()
    expect(reserveTaskFn).toHaveBeenCalledWith({ data: { taskId: 7 } })
    expect(completeTaskFn).not.toHaveBeenCalled()
    expect(success({ ok: true, status: 'reserved' })).toBe(cs.work.toast.reserved)
  })

  it('Hotovo completes the open task with confetti, without reserving it', () => {
    renderToStaticMarkup(<TakerBoard items={[open]} me={3} />)
    const el = { tag: 'button' }
    action.pressed.get(cs.work.done)?.onClick?.({ currentTarget: el })
    const [key, fn, , opts] = lastRun()
    expect(key).toBe('done-7')
    expect(opts).toEqual({ confetti: el, float: 8 })
    void fn()
    expect(completeTaskFn).toHaveBeenCalledWith({ data: { taskId: 7 } })
    expect(reserveTaskFn).not.toHaveBeenCalled()
  })

  it('both are disabled while anything on the board runs', () => {
    action.busy = 'done-1'
    renderToStaticMarkup(<TakerBoard items={[open]} me={3} />)
    expect(action.pressed.get(cs.work.reserve)?.disabled).toBe(true)
    expect(action.pressed.get(cs.work.done)?.disabled).toBe(true)
  })
})

describe('TakerBoard Volné row in reopened bidding (#212)', () => {
  it('with the switch on a free one-time task links to its page; off, plain name', () => {
    const open = view({ status: 'open', reservedBy: null })
    const on = renderToStaticMarkup(<TakerBoard items={[open]} me={3} rebid />)
    expect(on).toMatch(/<a[^>]*href="\/ukol\/1"[^>]*>Vyluxovat/)
    // The link is a full tap target, not one line of text.
    expect(on).toMatch(/<a[^>]*class="[^"]*min-h-tap[^"]*"[^>]*>Vyluxovat/)
    const off = renderToStaticMarkup(<TakerBoard items={[open]} me={3} />)
    expect(off).not.toContain('href="/ukol/1"')
  })
  it('a free chore copy stays a plain name with the switch on', () => {
    const chore = view({ status: 'open', reservedBy: null, origin: 'on_demand', templateId: 1 })
    expect(renderToStaticMarkup(<TakerBoard items={[chore]} me={3} rebid />)).not.toContain(
      'href="/ukol/1"',
    )
  })
  it('a round shows Vyjednává se on the row', () => {
    const open = view({
      status: 'open',
      reservedBy: null,
      rebidding: { offer: 6, offeredBy: null },
    })
    expect(renderToStaticMarkup(<TakerBoard items={[open]} me={3} rebid />)).toContain(
      cs.state.negotiating,
    )
  })
})

describe('TakerBoard Volné row when idle (#40)', () => {
  const open = view({ id: 7, title: 'Zalít květiny', status: 'open', reservedBy: null })

  it('both buttons are enabled while nothing runs, and only the tapped one is aria-busy', () => {
    renderToStaticMarkup(<TakerBoard items={[open]} me={3} />)
    expect(action.pressed.get(cs.work.reserve)?.disabled).toBe(false)
    expect(action.pressed.get(cs.work.done)?.disabled).toBe(false)
    expect(
      count(renderToStaticMarkup(<TakerBoard items={[open]} me={3} />), 'aria-busy="true"'),
    ).toBe(0)
    action.busy = 'reserve-7'
    const html = renderToStaticMarkup(<TakerBoard items={[open]} me={3} />)
    expect(html).toMatch(
      new RegExp(
        `aria-label="${cs.work.reserve}"[^>]*aria-busy="true"|aria-busy="true"[^>]*aria-label="${cs.work.reserve}"`,
      ),
    )
    expect(count(html, 'aria-busy="true"')).toBe(1)
  })
})

describe('the "+N" float after Hotovo (UI doc §4)', () => {
  const button = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 80, height: 44 }) }

  it('Hotovo asks for its score to float', () => {
    renderToStaticMarkup(<DoneButton task={{ id: 7, score: 5 }} busy={null} run={action.run} />)
    action.pressed.get(cs.work.done)?.onClick?.({ currentTarget: button })
    expect(lastRun()[3]).toEqual({ confetti: button, float: 5 })
  })

  it('floats in the pending colour where the button was, when it waits for approval', () => {
    expect(pointsFloat({ status: 'done_unconfirmed' }, { confetti: button, float: 5 })).toEqual({
      points: 5,
      tone: 'pending',
      rect: { left: 10, top: 20, width: 80, height: 44 },
    })
  })

  it('floats green when the points count at once', () => {
    expect(pointsFloat({ status: 'confirmed' }, { confetti: button, float: 5 })?.tone).toBe(
      'confirmed',
    )
  })

  it('floats nothing for actions that carry no points or no element', () => {
    expect(pointsFloat({ status: 'reserved' }, { confetti: button })).toBeNull()
    expect(pointsFloat({ status: 'confirmed' }, { confetti: null, float: 5 })).toBeNull()
  })
})

describe('✓ Schválit floats the points (UI doc §4 "Confirmed", #41)', () => {
  it('asks for the task score to float where it was tapped', () => {
    action.busy = null
    action.run.mockClear()
    const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 44, height: 44 }) }
    renderToStaticMarkup(<ToApprove items={[view({ status: 'done_unconfirmed', score: 12 })]} />)
    action.pressed.get(cs.work.approve)?.onClick?.({ currentTarget: el })
    expect(action.run.mock.calls[0]?.[3]).toEqual({ confetti: el, float: 12 })
  })
})

describe('TakerBoard instance rows show their due time (#38)', () => {
  const due = {
    origin: 'on_demand' as const,
    templateId: 1,
    dueAt: '2026-11-25T06:00:00.000Z',
    graceEndsAt: '2026-11-25T07:00:00.000Z',
  }
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-24T17:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('on Volné and, once reserved, on Moje', () => {
    const free = view({ id: 7, status: 'open', reservedBy: null, ...due })
    expect(renderToStaticMarkup(<TakerBoard items={[free]} me={3} />)).toContain('do zítra 7:00')
    const mine = view({ id: 7, ...due })
    expect(renderToStaticMarkup(<TakerBoard items={[mine]} me={STARSI.id} />)).toContain(
      'do zítra 7:00',
    )
  })
  it('an on-demand one without a deadline says when it was made', () => {
    const free = view({
      id: 7,
      status: 'open',
      reservedBy: null,
      origin: 'on_demand',
      templateId: 1,
      createdAt: '2026-11-24T14:02:00.000Z',
    })
    expect(renderToStaticMarkup(<TakerBoard items={[free]} me={3} />)).toContain(
      'na vyžádání · 15:02',
    )
  })
})
