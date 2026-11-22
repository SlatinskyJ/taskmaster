import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ButtonModule from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { cs } from '~/lib/strings'
import {
  approveProposalFn,
  proposePeriodFn,
  rejectProposalFn,
  withdrawProposalFn,
} from '~/server/periods/functions'
import {
  defaultsProposal,
  LONG_NAME,
  MAMA,
  MLADSI,
  periodProposal,
  proposalsView,
  STARSI,
  TATA,
} from './fixtures'
import { NextWeekView } from './NextWeekScreen'
import { ConfirmBody } from './ProposalCard'
import type { NextWeekViewProps } from './NextWeekScreen'
import {
  asksFirst,
  attempt,
  callProposalAction,
  proposalErrorMessage,
  proposeNextWeek,
  runProposalCall,
} from './proposalCalls'
import { initialNextWeek } from './proposalView'

// Příští týden (#43, UI doc §7.2 Period), rendered statically. Button records every button's
// label and click handler in render order, so a test can press the one on a given card.
const pressed = vi.hoisted(() => ({
  list: [] as { name: string; onClick?: () => void; disabled?: boolean }[],
}))
vi.mock('~/components/ui/button', async (original) => {
  const real = await original<typeof ButtonModule>()
  return {
    ...real,
    Button: (props: Parameters<typeof real.Button>[0]) => {
      const name = typeof props.children === 'string' ? props.children : props['aria-label']
      if (name !== undefined) {
        pressed.list.push({
          name,
          onClick: props.onClick as (() => void) | undefined,
          disabled: props.disabled,
        })
      }
      return real.Button(props)
    },
  }
})
const inputs = vi.hoisted(() => ({ change: [] as ((e: { target: { value: string } }) => void)[] }))
vi.mock('~/components/ui/input', () => ({
  Input: (props: { onChange?: (e: { target: { value: string } }) => void; value?: string }) => {
    if (props.onChange) inputs.change.push(props.onChange)
    return <input value={props.value} readOnly />
  },
}))
vi.mock('~/server/periods/functions', () => ({
  approveProposalFn: vi.fn(() => Promise.resolve({ ok: true, status: 'pending' })),
  rejectProposalFn: vi.fn(() => Promise.resolve({ ok: true, status: 'rejected' })),
  withdrawProposalFn: vi.fn(() => Promise.resolve({ ok: true, status: 'withdrawn' })),
  proposePeriodFn: vi.fn(() => Promise.resolve({ ok: true, status: 'pending' })),
  proposeDefaultsFn: vi.fn(() => Promise.resolve({ ok: true, status: 'pending' })),
}))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))

const t = cs.proposals
const noop = () => undefined

function render(over: Partial<NextWeekViewProps> = {}) {
  pressed.list = []
  return renderToStaticMarkup(
    <NextWeekView
      view={proposalsView()}
      me={{ id: MLADSI, role: 'taker' }}
      form={null}
      busy={null}
      error={null}
      onAct={noop}
      onOpenForm={noop}
      onFormChange={noop}
      onSubmit={noop}
      onCancelForm={noop}
      {...over}
    />,
  )
}
const names = () => pressed.list.map((b) => b.name)
const press = (name: string, nth = 0) => {
  const b = pressed.list.filter((x) => x.name === name)[nth]
  if (!b?.onClick) throw new Error(`no button ${name} #${String(nth)}`)
  b.onClick()
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Příští týden', () => {
  it('no running week: the empty state, no form button', () => {
    const html = render({ view: proposalsView({ running: null, next: null, defaultNext: null }) })
    expect(html).toContain(t.noWeek)
    expect(names()).not.toContain(t.proposeOther)
  })

  it('this week is locked and shows its dates and levels', () => {
    const html = render()
    expect(html).toContain('21. 11. – 29. 11.')
    expect(html).toContain(t.locked)
    expect(html).toContain(t.levels(50, 100))
  })

  it('waiting for me: Souhlasím and Nesouhlasím; Nesouhlasím asks first (onAct reject)', () => {
    const onAct = vi.fn()
    render({ view: proposalsView({ period: periodProposal() }), onAct })
    expect(names()).toEqual([t.approve, t.reject])
    press(t.reject)
    expect(onAct).toHaveBeenCalledExactlyOnceWith('period', 'reject')
  })

  it('the confirm dialog for Nesouhlasím says it ends for everybody; its confirm runs once', () => {
    const onConfirm = vi.fn()
    pressed.list = []
    const html = renderToStaticMarkup(
      <Dialog open>
        <ConfirmBody
          kind="period"
          action="reject"
          busy={false}
          onConfirm={onConfirm}
          onBack={noop}
        />
      </Dialog>,
    )
    expect(html).toContain(t.confirm.reject.title)
    expect(html).toContain(t.confirm.reject.body)
    press(t.confirm.reject.yes)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('withdrawing a default week says the default week stays', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ConfirmBody
          kind="defaults"
          action="withdraw"
          busy={false}
          onConfirm={noop}
          onBack={noop}
        />
      </Dialog>,
    )
    expect(html).toContain(t.confirm.withdraw.bodyDefaults)
    expect(html).not.toContain(t.confirm.withdraw.body)
  })

  it('saying no to a default week keeps the reject text', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ConfirmBody kind="defaults" action="reject" busy={false} onConfirm={noop} onBack={noop} />
      </Dialog>,
    )
    expect(html).toContain(t.confirm.reject.body)
    expect(html).not.toContain(t.confirm.withdraw.bodyDefaults)
  })

  it('the withdraw dialog has its own text', () => {
    const html = renderToStaticMarkup(
      <Dialog open>
        <ConfirmBody kind="period" action="withdraw" busy={false} onConfirm={noop} onBack={noop} />
      </Dialog>,
    )
    expect(html).toContain(t.confirm.withdraw.title)
    expect(html).toContain(t.confirm.withdraw.body)
  })

  it('I proposed: only Stáhnout návrh', () => {
    render({ view: proposalsView({ period: periodProposal() }), me: { id: STARSI, role: 'taker' } })
    expect(names()).toEqual([t.withdraw])
  })

  it('agreed: the Dohodnuto chip, Platí od, no buttons and no note', () => {
    const period = periodProposal({
      status: 'agreed',
      approvedBy: [STARSI, MLADSI, TATA],
      waitingFor: [],
    })
    const html = render({ view: proposalsView({ period }) })
    expect(html).toContain(t.agreedChip)
    expect(html).toContain(t.validFrom('ne 29. 11. 23:59'))
    expect(names()).toEqual([])
    expect(html).not.toContain('Změna platí')
  })

  it('old → new: the default week struck through next to the proposal', () => {
    const html = render({ view: proposalsView({ period: periodProposal() }) })
    expect(html).toContain('<s class="text-muted">ne 6. 12. 23:59</s>')
    expect(html).toContain('so 5. 12. 20:00')
    expect(html).toContain('<s class="text-muted">7 dní</s>')
    expect(html).toContain('6 dní')
    expect(html).toContain('<s class="text-muted">50</s>')
  })

  it('the old value is the server defaultNext, not a 7-day week (running week ends on Wednesday)', () => {
    const view = proposalsView({
      period: periodProposal({
        settings: { cutoffAt: '2026-12-05T19:00:00.000Z', levels: { lower: 50, upper: 100 } },
      }),
      defaultNext: {
        startsAt: '2026-11-29T22:59:00.000Z',
        cutoffAt: '2026-12-02T22:59:00.000Z',
        levels: { lower: 50, upper: 100 },
      },
    })
    const html = render({ view })
    expect(html).toContain('<s class="text-muted">3 dny</s>')
    // An unchanged value shows once.
    expect(html).not.toContain('<s class="text-muted">50</s>')
  })

  it('the note names the rule, the deadline and the default week', () => {
    const html = render()
    expect(html).toContain(t.note('ne 29. 11. 23:59', '7 dní', 50, 100))
    expect(t.note('x', 'y', 1, 2)).toContain('všichni kluci a jeden rodič do x')
  })

  it('a second giver after one giver approved sees Nesouhlasím and no Souhlasím', () => {
    const view = proposalsView({
      period: periodProposal({ approvedBy: [STARSI, TATA], waitingFor: [MLADSI] }),
      parties: [...proposalsView().parties, { id: MAMA, name: 'Máma', role: 'giver' }],
    })
    const html = render({ view, me: { id: MAMA, role: 'giver' } })
    expect(names()).toContain(t.reject)
    expect(names()).not.toContain(t.approve)
    expect(html).not.toContain('>Máma<')
  })

  it('the chip names the proposer', () => {
    expect(render({ view: proposalsView({ period: periodProposal() }) })).toContain(
      t.proposedBy('Starší'),
    )
  })

  it('wiring: each card acts with its own kind even when the ids collide', () => {
    const onAct = vi.fn()
    render({
      view: proposalsView({ period: periodProposal(), defaults: defaultsProposal() }),
      onAct,
    })
    press(t.approve, 0)
    press(t.approve, 1)
    press(t.reject, 1)
    expect(onAct.mock.calls).toEqual([
      ['period', 'approve'],
      ['defaults', 'approve'],
      ['defaults', 'reject'],
    ])
  })

  it('callProposalAction sends that card’s kind and id to the right function', async () => {
    for (const kind of ['period', 'defaults'] as const) {
      await callProposalAction('approve', kind, 1)
      await callProposalAction('reject', kind, 1)
      await callProposalAction('withdraw', kind, 1)
      expect(approveProposalFn).toHaveBeenLastCalledWith({ data: { kind, id: 1 } })
      expect(rejectProposalFn).toHaveBeenLastCalledWith({ data: { kind, id: 1 } })
      expect(withdrawProposalFn).toHaveBeenLastCalledWith({ data: { kind, id: 1 } })
    }
    expect(approveProposalFn).toHaveBeenCalledTimes(2)
  })

  it('no proposal: Navrhnout jinak opens the form, which shows the end', () => {
    const onOpenForm = vi.fn()
    render({ onOpenForm })
    press(t.proposeOther)
    expect(onOpenForm).toHaveBeenCalledTimes(1)
    const v = proposalsView()
    const n =
      v.next ??
      (() => {
        throw new Error('next')
      })()
    const form = initialNextWeek({
      startsAt: new Date(n.startsAt),
      cutoffAt: new Date(n.cutoffAt),
      levels: n.levels,
    })
    const html = render({ form })
    expect(html).toContain(t.endLine('ne 6. 12. 23:59'))
    expect(names()).toContain(t.proposeAll)
  })

  it('submitting sends exactly the cutoff counted from next.startsAt', async () => {
    const form = { lengthDays: 7, hour: 23, minute: 59, levels: { lower: 50, upper: 100 } }
    await proposeNextWeek(new Date('2026-11-29T22:59:00.000Z'), form)
    expect(proposePeriodFn).toHaveBeenCalledExactlyOnceWith({
      data: { cutoffAt: '2026-12-06T22:59:00.000Z', levels: { lower: 50, upper: 100 } },
    })
  })

  it('over the cap: the line shows and Navrhnout všem is disabled', () => {
    const html = render({
      form: { lengthDays: 364, hour: 23, minute: 59, levels: { lower: 50, upper: 100 } },
    })
    expect(html).not.toContain(t.tooLong)
    const long = render({
      view: proposalsView({
        next: {
          startsAt: '2026-11-29T11:00:00.000Z',
          cutoffAt: '2026-12-06T22:59:00.000Z',
          levels: { lower: 50, upper: 100 },
        },
      }),
      form: { lengthDays: 364, hour: 23, minute: 59, levels: { lower: 50, upper: 100 } },
    })
    expect(long).toContain(t.tooLong)
    expect(pressed.list.find((b) => b.name === t.proposeAll)?.disabled).toBe(true)
    expect(pressed.list.find((b) => b.name === t.longer)?.disabled).toBe(true)
  })

  it('already_started and every other code map to their Czech text', () => {
    expect(proposalErrorMessage('already_started')).toBe('Příští týden už začal, návrh už neplatí.')
    expect(proposalErrorMessage('proposal_pending')).toBe(t.errors.pending)
    expect(proposalErrorMessage('already_agreed')).toBe(t.errors.alreadyAgreed)
    expect(proposalErrorMessage('invalid_settings')).toBe(t.errors.invalid)
    expect(proposalErrorMessage('not_pending')).toBe(t.errors.gone)
    expect(proposalErrorMessage('not_found')).toBe(t.errors.gone)
    for (const c of ['not_proposer', 'not_a_party', 'not_a_giver', 'feature_off']) {
      expect(proposalErrorMessage(c)).toBe(t.errors.forbidden)
    }
    expect(proposalErrorMessage('no_running_period')).toBe(t.errors.noWeek)
    expect(proposalErrorMessage('whatever')).toBe(t.errors.failed)
  })

  it('a refusal gives its text; a throw gives the generic text', async () => {
    expect(await attempt(() => Promise.resolve({ ok: false, error: 'proposal_pending' }))).toBe(
      t.errors.pending,
    )
    expect(await attempt(() => Promise.reject(new Error('net')))).toBe(t.errors.failed)
    expect(await attempt(() => Promise.resolve({ ok: true, status: 'pending' }))).toBeNull()
  })

  it('an error shows under the form, which keeps its values', () => {
    const form = { lengthDays: 6, hour: 20, minute: 0, levels: { lower: 60, upper: 120 } }
    const html = render({ form, error: { at: 'form', text: t.errors.failed } })
    expect(html).toContain(t.errors.failed)
    expect(html).toContain('6 dní')
    expect(html).toContain('value="20:00"')
  })

  it('day plurals: 1 den, 3 dny, 7 dní', () => {
    expect([t.days(1), t.days(3), t.days(7), t.days(5)]).toEqual([
      '1 den',
      '3 dny',
      '7 dní',
      '5 dní',
    ])
  })

  it('a taker has no Výchozí týden link; a giver has it', () => {
    expect(render()).not.toContain('/tyden/vychozi')
    expect(render({ me: { id: TATA, role: 'giver' } })).toContain('href="/tyden/vychozi"')
  })

  it('a 30-letter name wraps in the agreement rows', () => {
    const view = proposalsView({
      period: periodProposal(),
      parties: [{ id: TATA, name: LONG_NAME, role: 'giver' }, ...proposalsView().parties.slice(1)],
    })
    expect(render({ view })).toContain(
      `<span class="min-w-0 font-bold break-words">${LONG_NAME}</span>`,
    )
  })

  it('busy: every button of the card is disabled, the pressed one says Posílám…', () => {
    render({ view: proposalsView({ period: periodProposal() }), busy: 'period:approve' })
    expect(names()).toEqual([t.sending, t.reject])
    expect(pressed.list.every((b) => b.disabled)).toBe(true)
  })

  it('the form controls: Kratší, Delší, both levels and the end time each change the form', () => {
    const form = { lengthDays: 7, hour: 23, minute: 59, levels: { lower: 50, upper: 100 } }
    const onFormChange = vi.fn()
    inputs.change = []
    render({ form, onFormChange })
    expect(pressed.list.find((b) => b.name === t.shorter)?.disabled).toBe(false)
    expect(pressed.list.find((b) => b.name === t.proposeAll)?.disabled).toBe(false)
    press(t.longer)
    press(t.shorter)
    press(cs.admin.defaults.more(t.lower))
    press(cs.admin.defaults.less(t.upper))
    inputs.change[0]?.({ target: { value: '18:30' } })
    inputs.change[0]?.({ target: { value: '' } })
    expect(onFormChange.mock.calls.map((c) => c[0] as unknown)).toEqual([
      { ...form, lengthDays: 8 },
      { ...form, lengthDays: 6 },
      { ...form, levels: { lower: 51, upper: 100 } },
      { ...form, levels: { lower: 50, upper: 99 } },
      { ...form, hour: 18, minute: 30 },
    ])
  })

  it('Kratší stops at 1 day; Zrušit cancels; Navrhnout všem submits', () => {
    const onCancelForm = vi.fn()
    const onSubmit = vi.fn()
    render({
      form: { lengthDays: 1, hour: 23, minute: 59, levels: { lower: 50, upper: 100 } },
      onCancelForm,
      onSubmit,
    })
    expect(pressed.list.find((b) => b.name === t.shorter)?.disabled).toBe(true)
    expect(pressed.list.find((b) => b.name === t.longer)?.disabled).toBe(false)
    press(t.cancel)
    press(t.proposeAll)
    expect(onCancelForm).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('while sending, the form buttons are disabled and say Posílám…', () => {
    render({
      form: { lengthDays: 7, hour: 23, minute: 59, levels: { lower: 50, upper: 100 } },
      busy: 'propose',
    })
    expect(pressed.list.find((b) => b.name === t.sending)?.disabled).toBe(true)
    expect(pressed.list.find((b) => b.name === t.cancel)?.disabled).toBe(true)
  })
})

describe('running a call', () => {
  const ui = () => ({
    busy: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    reload: vi.fn(() => Promise.resolve()),
  })

  it('only Souhlasím runs at once; the others ask first', () => {
    expect([asksFirst('approve'), asksFirst('reject'), asksFirst('withdraw')]).toEqual([
      false,
      true,
      true,
    ])
  })

  it('success: busy on and off, the toast, the reload, no error', async () => {
    const u = ui()
    const ok = await runProposalCall(
      'period:approve',
      () => Promise.resolve({ ok: true, status: 'pending' }),
      t.done.approve,
      u,
    )
    expect(ok).toBe(true)
    expect(u.busy.mock.calls).toEqual([['period:approve'], [null]])
    expect(u.error.mock.calls).toEqual([[null]])
    expect(u.success).toHaveBeenCalledExactlyOnceWith(t.done.approve)
    expect(u.reload).toHaveBeenCalledTimes(1)
  })

  it('a refusal: its Czech text on the error line, no toast, no reload', async () => {
    const u = ui()
    const ok = await runProposalCall(
      'propose',
      () => Promise.resolve({ ok: false, error: 'already_started' }),
      t.sent,
      u,
    )
    expect(ok).toBe(false)
    expect(u.error.mock.calls).toEqual([[null], [t.errors.alreadyStarted]])
    expect(u.busy.mock.calls).toEqual([['propose'], [null]])
    expect(u.success).not.toHaveBeenCalled()
    expect(u.reload).not.toHaveBeenCalled()
  })

  it('a throw: the generic text', async () => {
    const u = ui()
    expect(await runProposalCall('x', () => Promise.reject(new Error('net')), t.sent, u)).toBe(
      false,
    )
    expect(u.error).toHaveBeenLastCalledWith(t.errors.failed)
  })
})
