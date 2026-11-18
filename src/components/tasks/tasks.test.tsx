import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PointsBar } from '~/components/points/PointsBar'
import { cs, type ItemStateKey } from '~/lib/strings'
import { StateChip } from './StateChip'
import { STATE_CHIP_BG, STATE_DOT, STATE_STRIPE, STATE_TEXT } from './stateStyles'
import { TaskRow } from './TaskRow'
import { WaitingForYou } from './WaitingForYou'

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
    approvedBy: ['Táta'],
    reservedBy: null,
    completedBy: null,
    completedAt: null,
    earnerId: null,
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
    const html = renderToStaticMarkup(<WaitingForYou items={[task]} templates={[template]} />)
    expect(html).toContain(`${cs.home.waiting} (2)`)
    expect(html).toContain(
      'Po, Út, St, Čt, Pá, So, Ne v 18:00 · do dalšího dne 7:00 (+2 h) · schvaluje rodič · Souhlasí: Táta',
    )
    expect(html).toContain(cs.templates.recurringMeta)
  })

  it('renders nothing when nothing waits', () => {
    expect(renderToStaticMarkup(<WaitingForYou items={[]} templates={[]} />)).toBe('')
  })
})
