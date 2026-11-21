import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PointsBar } from '~/components/points/PointsBar'
import { cs, type ItemStateKey } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'
import { StateChip } from './StateChip'
import { STATE_CHIP_BG, STATE_DOT, STATE_STRIPE, STATE_TEXT } from './stateStyles'
import { TaskRow } from './TaskRow'
import { WaitingForYou } from './WaitingForYou'
import { ToApprove } from './ToApprove'

// ToApprove needs the router (useTaskAction) and server functions; neither runs in a static render.
const action = vi.hoisted(() => ({ busy: null as string | null }))
vi.mock('./useTaskAction', () => ({
  useTaskAction: () => ({ busy: action.busy, run: vi.fn() }),
}))
vi.mock('~/server/tasks/functions', () => ({ approveTaskFn: vi.fn(), rejectTaskFn: vi.fn() }))
vi.mock('./bidCalls', () => ({ callBid: vi.fn(), BID_CALLS: {} }))
// WaitingForYou's task rows link to the task page (#34); a plain <a> stands in for the router.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

const STATES = Object.keys(cs.state) as ItemStateKey[]

describe('state styles', () => {
  it.each(STATES)('%s has a dot, text, chip and stripe colour of its own state', (s) => {
    expect(STATE_DOT[s]).toBe(`bg-state-${s}`)
    expect(STATE_TEXT[s]).toBe(`text-state-${s}-text`)
    expect(STATE_CHIP_BG[s]).toBe(`bg-state-${s}/15`)
    expect(STATE_STRIPE[s]).toBe(`border-l-state-${s}`)
  })
})

describe('StateChip', () => {
  it('shows the Czech label in the state colours', () => {
    const html = renderToStaticMarkup(<StateChip state="pending" />)
    expect(html).toContain(cs.state.pending)
    expect(html).toContain('text-state-pending-text')
    expect(html).toContain('bg-state-pending/15')
  })
})

describe('TaskRow', () => {
  it('has the left stripe, chip, name and points', () => {
    const html = renderToStaticMarkup(<TaskRow name="Vyndat myčku" state="reserved" points={15} />)
    expect(html).toContain('border-l-4')
    expect(html).toContain('border-l-state-reserved')
    expect(html).toContain(cs.state.reserved)
    expect(html).toContain('Vyndat myčku')
    expect(html).toContain('>15<')
  })
})

describe('TaskRow chip and meta line', () => {
  it('wraps the meta under the chip instead of squeezing it', () => {
    const html = renderToStaticMarkup(
      <TaskRow
        name="Vyluxovat celý obývák a chodbu"
        state="pending"
        points={5}
        meta="Udělal Mladší"
      />,
    )
    const line = /<div[^>]*data-slot="task-status"[^>]*>/.exec(html)?.[0] ?? ''
    expect(line).toContain('flex-wrap')
    const meta = /<span[^>]*data-slot="task-meta"[^>]*>/.exec(html)?.[0] ?? ''
    expect(meta).toContain('max-w-full')
    expect(meta).toContain('truncate')
    expect(meta).not.toMatch(/min-w-0|shrink-/)
  })

  it('renders no meta span without meta', () => {
    const html = renderToStaticMarkup(<TaskRow name="Vynést koš" state="open" points={5} />)
    expect(html).not.toContain('data-slot="task-meta"')
  })
})

describe('TaskRow points colour', () => {
  it.each([
    ['pending', 'text-state-pending-text'],
    ['confirmed', 'text-state-confirmed-text'],
  ] as const)('%s points use the state text colour', (state, cls) => {
    const html = renderToStaticMarkup(<TaskRow name="Vynést koš" state={state} points={5} />)
    expect(html).toMatch(new RegExp(`class="[^"]*num[^"]*${cls}[^"]*">5<`))
  })

  it('open points stay ink', () => {
    const html = renderToStaticMarkup(<TaskRow name="Vynést koš" state="open" points={5} />)
    expect(html).toMatch(/class="num text-base font-bold whitespace-nowrap">5</)
  })
})

describe('PointsBar', () => {
  it('reads out confirmed, pending and both levels in Czech', () => {
    const html = renderToStaticMarkup(
      <PointsBar confirmed={45} pending={15} lower={50} upper={100} />,
    )
    expect(html).toContain('aria-label="45 bodů potvrzeno, 15 čeká, spodní hranice 50, horní 100"')
    expect(html).toContain('width:37.5%')
    expect(html).toContain('width:50%')
  })

  it('renders without animation classes on the server (effects start off until hydrated)', () => {
    const html = renderToStaticMarkup(
      <PointsBar confirmed={45} pending={15} lower={50} upper={100} />,
    )
    expect(html).not.toContain('bar-grow')
    expect(html).not.toContain('animate-bar-glow')
  })
})

describe('TaskRow for templates (#37)', () => {
  it('stateLabel overrides the chip text', () => {
    const html = renderToStaticMarkup(
      <TaskRow name="Vyndat myčku" state="confirmed" stateLabel="Platí" points={3} />,
    )
    expect(html).toContain('>Platí<')
    expect(html).not.toContain(`>${cs.state.confirmed}<`)
  })

  it('detail is a full line that wraps, not cut', () => {
    const detail =
      'Po, Út, St, Čt, Pá, So, Ne v 18:00 · do dalšího dne 7:00 (+2 h) · schvaluje rodič'
    const html = renderToStaticMarkup(
      <TaskRow name="Vynést koše" state="proposed" points={4} detail={detail} />,
    )
    const line = /<p[^>]*data-slot="task-detail"[^>]*>([^<]*)<\/p>/.exec(html)
    expect(line?.[1]).toBe(detail)
    expect(line?.[0]).not.toContain('truncate')
    expect(line?.[0]).not.toContain('line-clamp')
  })
})

describe('WaitingForYou with templates (#37)', () => {
  const task = {
    id: 1,
    title: 'Umýt auto',
    status: 'proposed' as const,
    score: 18,
    approvalRequired: true,
    createdByName: 'Táta',
    offeredByName: 'Táta',
    approvedBy: ['Táta'],
    approverIds: [2],
    bids: [],
    lowest: null,
    reservedBy: null,
    completedBy: null,
    completedAt: null,
    earnerId: null,
    waitingFor: [],
  }
  const template = {
    id: 1,
    title: 'Vynést koše',
    status: 'proposed' as const,
    score: 4,
    approvalRequired: true,
    createdByName: 'Táta',
    approvedBy: ['Táta'],
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[], time: '18:00' },
    deadline: { dayOffset: 1, due: '07:00', graceMinutes: 120 },
  }

  it('counts tasks and templates and shows the full template detail', () => {
    const html = renderToStaticMarkup(
      <WaitingForYou items={[task]} templates={[template]} me={{ id: 3, role: 'taker' }} />,
    )
    expect(html).toContain(`${cs.home.waiting} (2)`)
    expect(html).toContain(
      'Po, Út, St, Čt, Pá, So, Ne v 18:00 · do dalšího dne 7:00 (+2 h) · schvaluje rodič · Souhlasí: Táta',
    )
    expect(html).toContain(cs.templates.recurringMeta)
  })

  it('renders nothing when nothing waits', () => {
    expect(
      renderToStaticMarkup(
        <WaitingForYou items={[]} templates={[]} me={{ id: 3, role: 'taker' }} />,
      ),
    ).toBe('')
  })
})

describe('ToApprove', () => {
  const item: TaskView = {
    id: 1,
    title: 'Vyluxovat celý obývák a chodbu',
    status: 'done_unconfirmed',
    score: 5,
    approvalRequired: true,
    createdByName: 'Táta',
    offeredByName: null,
    approvedBy: [],
    approverIds: [],
    bids: [],
    lowest: null,
    reservedBy: { id: 4, name: 'Mladší' },
    completedBy: { id: 4, name: 'Mladší' },
    completedAt: '2026-11-18T14:00:00.000Z',
    earnerId: 4,
    waitingFor: [],
  }
  const buttons = (html: string) => html.match(/<button[\s\S]*?<\/button>/g) ?? []
  function byLabel(html: string, label: string): string {
    const found = buttons(html).filter((b) =>
      /^<button[^>]*>/.exec(b)?.[0].includes(`aria-label="${label}"`),
    )
    if (found.length !== 1)
      throw new Error(`expected one button "${label}", got ${String(found.length)}`)
    return found[0] ?? ''
  }

  it('shows ✕ Zamítnout and ✓ Schválit as 44 px icon buttons, each with its own label, colour and icon', () => {
    action.busy = null
    const html = renderToStaticMarkup(<ToApprove items={[item]} />)
    expect(buttons(html)).toHaveLength(2)
    const reject = byLabel(html, cs.work.reject)
    const approve = byLabel(html, cs.work.approve)
    expect(reject).toContain('border-state-rejected') // variant "no"
    expect(reject).toContain('lucide-x')
    expect(reject).not.toContain('lucide-check')
    expect(approve).toContain('bg-ok') // variant "ok"
    expect(approve).toContain('lucide-check')
    expect(approve).not.toContain('lucide-x')
    for (const b of [reject, approve]) {
      expect(b).toContain('size-tap')
      expect(b).not.toMatch(/>(Zamítnout|Schválit)</) // no visible text to squeeze the row
    }
    expect(html).toContain(`${cs.work.doneBy} Mladší`)
  })

  it('disables both buttons and marks Schválit busy while an approve runs', () => {
    action.busy = 'approve-1'
    const html = renderToStaticMarkup(<ToApprove items={[item]} />)
    expect(byLabel(html, cs.work.reject)).toMatch(/<button[^>]*disabled/)
    expect(byLabel(html, cs.work.approve)).toMatch(/<button[^>]*disabled/)
    expect(byLabel(html, cs.work.approve)).toMatch(/<button[^>]*aria-busy="true"/)
    expect(byLabel(html, cs.work.reject)).not.toContain('aria-busy="true"')
  })
})
