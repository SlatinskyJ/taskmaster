import { describe, expect, it } from 'vitest'
import type { TaskView } from '~/server/tasks/functions'
import { cs } from '~/lib/strings'
import {
  canApprove,
  canTakeFree,
  bidButtons,
  canProposeChange,
  canWorkOn,
  changeAnswer,
  changeHint,
  detailMeta,
  instanceMeta,
  lowestText,
  myBid,
  refuseButton,
  reopenButton,
  roundLines,
  sendButton,
  taskChipState,
  threadTime,
  toastFor,
  waitingMeta,
  waitingOnTakers,
  waitingText,
} from './taskView'
import type { BidAction, BidCall } from './taskView'

// Every decision the bidding screens make (#34). Components only render what these return.

const view = (over: Partial<TaskView>): TaskView => ({
  id: 1,
  title: 'Vyluxovat celý obývák a chodbu',
  status: 'proposed',
  score: 18,
  approvalRequired: true,
  createdByName: 'Táta',
  offeredByName: 'Táta',
  approvedBy: ['Táta'],
  approverIds: [2],
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
  scoreChange: null,
  rebidding: null,
  ...over,
})
const b = (takerId: number, name: string, score: number) => ({ takerId, name, score })
/** A call by its action, with plain data (a turn-down of one bid, a counter at no bid). */
const call = (action: BidAction): BidCall => {
  switch (action) {
    case 'acceptLowestTaskBid':
    case 'counterOffer':
      return { action, data: { taskId: 1, score: 18, bidders: [] } }
    case 'withdrawBid':
    case 'reopenBidding':
      return { action, data: { taskId: 1 } }
    case 'turnDownBids':
      return { action, data: { taskId: 1, bids: [{ takerId: 3, score: 25 }] } }
    default:
      return { action, data: { taskId: 1, score: 18 } }
  }
}
const low = (score: number, ...bidders: { id: number; name: string }[]) => ({ score, bidders })

describe('taskView', () => {
  // `low(score, ...bidders)` builds a `lowest`; b(takerId, name, score) a bid.
  const STARSI = { id: 3, role: 'taker' } as const,
    MLADSI = { id: 4, role: 'taker' } as const
  const TATA = { id: 2, role: 'giver' } as const,
    ADMIN = { id: 1, role: 'admin' } as const
  const keys = (bs: { key: string }[]) => bs.map((x) => x.key)

  it('chip: proposed, negotiating once someone bid, pending for done_unconfirmed', () => {
    expect(
      [view({}), view({ bids: [b(3, 'Starší', 25)] }), view({ status: 'done_unconfirmed' })].map(
        taskChipState,
      ),
    ).toEqual(['proposed', 'negotiating', 'pending'])
  })
  it('a brother without a bid says yes (open for all); with a bid he picks: his first, then open for all', () => {
    expect(bidButtons(view({}), STARSI)).toEqual([
      {
        key: 'approve',
        action: 'approveOffer',
        data: { taskId: 1, score: 18 },
        label: 'Souhlasím',
        hint: 'Úkol bude volný pro všechny.',
        variant: 'ok',
      },
    ])
    const bids = [b(4, 'Mladší', 22), b(3, 'Starší', 25)]
    expect(bidButtons(view({ bids }), STARSI)).toEqual([
      {
        key: 'take',
        action: 'acceptOffer',
        data: { taskId: 1, score: 18 },
        label: 'Beru za 18',
        hint: 'Úkol bude tvůj.',
        variant: 'ok',
      },
      {
        key: 'approve',
        action: 'approveOffer',
        data: { taskId: 1, score: 18 },
        label: 'Souhlasím',
        hint: 'Úkol bude volný pro všechny.',
        variant: 'ghost',
      },
    ])
  })
  it('a brother who already said yes is not asked again, bid or not (decision 2)', () => {
    expect(keys(bidButtons(view({ approverIds: [2, 3] }), STARSI))).toEqual([])
    expect(
      keys(bidButtons(view({ approverIds: [2, 3], bids: [b(3, 'Starší', 25)] }), STARSI)),
    ).toEqual([])
  })
  it("myBid is his own bid, never the other brother's or the lowest", () => {
    const both = view({
      bids: [b(4, 'Mladší', 22), b(3, 'Starší', 25)],
      lowest: low(22, { id: 4, name: 'Mladší' }),
      lastBids: [],
    })
    expect([myBid(both, STARSI), myBid(both, MLADSI)]).toEqual([25, 22])
    const other = view({ bids: [b(4, 'Mladší', 22)], lowest: low(22, { id: 4, name: 'Mladší' }) })
    expect(myBid(other, STARSI)).toBeNull()
    expect(keys(bidButtons(other, STARSI))).toEqual(['approve'])
    expect(waitingMeta(other, STARSI)).toBe('Nabízí Táta')
  })
  it('who the offer still waits for', () => {
    const brothers = [
      { id: 3, name: 'Starší' },
      { id: 4, name: 'Mladší' },
    ]
    expect(waitingText(view({ waitingFor: brothers }), TATA)).toBe('Čeká se na: Starší nebo Mladší')
    expect(waitingText(view({ waitingFor: brothers }), STARSI)).toBe('Čeká se na: tebe nebo Mladší')
    expect(waitingText(view({ waitingFor: [] }), TATA)).toBeNull()
    expect(waitingText(view({ status: 'open', waitingFor: brothers }), TATA)).toBeNull()
  })
  it('a parent accepts the lowest bid as the server sent it: one bidder reserves, a tie opens', () => {
    expect(bidButtons(view({}), TATA)).toEqual([])
    const one = view({
      bids: [b(4, 'Mladší', 22), b(3, 'Starší', 25)],
      lowest: low(22, { id: 4, name: 'Mladší' }),
      lastBids: [],
    })
    expect(bidButtons(one, TATA)).toEqual([
      {
        key: 'yes',
        action: 'acceptLowestTaskBid',
        data: { taskId: 1, score: 22, bidders: [4] },
        label: 'Přijmout 22 (Mladší)',
        hint: 'Úkol bude rezervovaný pro Mladší.',
        variant: 'ok',
      },
    ])
    const tie = view({
      bids: [b(3, 'Starší', 22), b(4, 'Mladší', 22)],
      lowest: low(22, { id: 3, name: 'Starší' }, { id: 4, name: 'Mladší' }),
      lastBids: [],
    })
    expect(bidButtons(tie, TATA)[0]).toMatchObject({
      label: 'Přijmout 22',
      hint: 'Stejnou cenu chce víc lidí. Úkol bude volný.',
      data: { bidders: [3, 4] },
    })
  })
  it("a parent's counter: a new offer off the bids, an accept exactly on one (decision 8b)", () => {
    const t = view({ bids: [b(4, 'Mladší', 22), b(3, 'Starší', 25), b(5, 'Bratranec', 25)] })
    expect(sendButton(t, TATA, 21)).toMatchObject({
      action: 'counterOffer',
      data: { taskId: 1, score: 21, bidders: [] },
      label: 'Nabídnout',
      hint: 'Nová nabídka pro všechny.',
      disabled: false,
    })
    expect(sendButton(t, TATA, 22)).toMatchObject({
      data: { score: 22, bidders: [4] },
      label: 'Přijmout 22 (Mladší)',
      hint: 'Úkol bude rezervovaný pro Mladší.',
    })
    expect(sendButton(t, TATA, 23)).toMatchObject({ data: { bidders: [] }, label: 'Nabídnout' })
    expect(sendButton(t, TATA, 25)).toMatchObject({
      data: { bidders: [3, 5] },
      label: 'Přijmout 25',
      hint: 'Stejnou cenu chce víc lidí. Úkol bude volný.',
    })
    expect(sendButton(t, TATA, 18)?.disabled).toBe(true)
    expect(sendButton(view({}), TATA, 30)).toMatchObject({ label: 'Nabídnout', disabled: false }) // decision 8a
  })
  it("a brother's bid: not the offer, not his own bid again", () => {
    const t = view({ bids: [b(3, 'Starší', 25)], lastBids: [{ takerId: 3, score: 25 }] })
    expect([18, 25, 24].map((n) => sendButton(t, STARSI, n)?.disabled)).toEqual([true, true, false])
    expect(sendButton(t, STARSI, 24)).toMatchObject({
      action: 'placeBid',
      data: { taskId: 1, score: 24 },
      label: 'Nabídnout',
      hint: 'Nabídka půjde rodičům.',
    })
  })
  it('same number (Jakub 2026-11-24): his previous bid waits for a counter, with its own hint', () => {
    const before = view({ lastBids: [{ takerId: 3, score: 5 }] })
    expect(sendButton(before, STARSI, 5)).toMatchObject({
      disabled: true,
      hint: cs.bids.sameAgainHint,
    })
    expect(sendButton(before, STARSI, 6)).toMatchObject({ disabled: false, hint: cs.bids.bidHint })
    const countered = view({ bids: [b(3, 'Starší', 5)], lastBids: [] })
    expect(sendButton(countered, STARSI, 5)?.disabled).toBe(false)
    const other = view({ lastBids: [{ takerId: 4, score: 25 }] })
    expect(sendButton(other, STARSI, 25)?.disabled).toBe(false)
    expect(sendButton(view({}), STARSI, 18)).toMatchObject({
      disabled: true,
      hint: cs.bids.bidHint,
    })
  })
  it('Nechci: a brother with an open bid, only with the switch on', () => {
    const t = view({ bids: [b(3, 'Starší', 25), b(4, 'Mladší', 22)] })
    expect(refuseButton(t, STARSI, true)).toMatchObject({
      key: 'refuse',
      action: 'withdrawBid',
      data: { taskId: 1 },
      label: 'Nechci',
      hint: cs.bids.withdrawHint,
      variant: 'ghost',
    })
    expect(refuseButton(view({ bids: [b(4, 'Mladší', 22)] }), STARSI, true)).toBeNull()
    expect(refuseButton(t, STARSI, false)).toBeNull()
  })
  it('Odmítnout nabídky: a parent with bids sends the bids he sees, only with the switch on', () => {
    const t = view({ bids: [b(4, 'Mladší', 22), b(3, 'Starší', 25)] })
    expect(refuseButton(t, TATA, true)).toMatchObject({
      key: 'refuse',
      action: 'turnDownBids',
      data: {
        taskId: 1,
        bids: [
          { takerId: 4, score: 22 },
          { takerId: 3, score: 25 },
        ],
      },
      label: 'Odmítnout nabídky',
      hint: cs.bids.turnDownHint(18),
      variant: 'ghost',
    })
    expect(refuseButton(view({}), TATA, true)).toBeNull()
    expect(refuseButton(t, TATA, false)).toBeNull()
    expect(refuseButton({ ...t, status: 'open' }, TATA, true)).toBeNull()
    expect(refuseButton(t, ADMIN, true)).toBeNull()
  })
  it('refusal toasts', () => {
    expect(toastFor(call('withdrawBid'), 'proposed', STARSI, false)).toBe('Nabídka stažena')
    expect(toastFor(call('turnDownBids'), 'proposed', TATA, false)).toBe('Nabídky odmítnuty')
  })
  it('nothing to do once agreed, or for the admin', () => {
    for (const [t, me] of [
      [view({ status: 'reserved' }), STARSI],
      [view({ status: 'open' }), TATA],
      [view({}), ADMIN],
    ] as const) {
      expect(bidButtons(t, me)).toEqual([])
      expect(sendButton(t, me, 30)).toBeNull()
    }
  })
  it('row and page texts', () => {
    expect(waitingMeta(view({}), STARSI)).toBe('Nabízí Táta')
    expect(
      waitingMeta(view({ score: 20, offeredByName: 'Máma', bids: [b(3, 'Starší', 25)] }), STARSI),
    ).toBe('Máma 20 · ty 25')
    expect(lowestText(low(22, { id: 3, name: 'Starší' }, { id: 4, name: 'Mladší' }))).toBe(
      'Starší, Mladší chtějí 22',
    )
    const reserved = view({
      status: 'reserved',
      offeredByName: null,
      reservedBy: { id: 4, name: 'Mladší' },
    })
    expect([
      detailMeta(reserved, MLADSI),
      detailMeta(reserved, STARSI),
      detailMeta(view({ status: 'open', offeredByName: null }), STARSI),
    ]).toEqual(['Je to tvoje', 'Rezervoval Mladší', null])
  })
  it('thread times are Prague wall clock: Saturday 23:30 UTC is Sunday 00:30', () => {
    expect(threadTime('2026-11-21T09:12:00.000Z')).toBe('so 10:12')
    expect(threadTime('2026-11-21T23:30:00.000Z')).toBe('ne 00:30')
  })
  it('toasts: mine, agreed, approved, sent', () => {
    expect([
      toastFor(call('acceptOffer'), 'reserved', STARSI, false),
      toastFor(call('acceptLowestTaskBid'), 'reserved', TATA, false),
      toastFor(call('approveOffer'), 'open', STARSI, false),
      toastFor(call('approveOffer'), 'proposed', TATA, false),
      toastFor(call('placeBid'), 'proposed', STARSI, false),
      toastFor(call('counterOffer'), 'proposed', TATA, false),
      toastFor(call('counterOffer'), 'open', TATA, false),
    ]).toEqual([
      'Domluveno, úkol je tvůj',
      'Domluveno',
      'Domluveno',
      'Schváleno',
      'Nabídka odeslána',
      'Nabídka odeslána',
      'Domluveno',
    ])
  })
  it('Schválit and Zamítnout only for a parent, only on done work not yet confirmed (#206)', () => {
    const done = view({ status: 'done_unconfirmed' })
    expect(canApprove(done, TATA)).toBe(true)
    expect(canApprove(done, STARSI)).toBe(false)
    expect(canApprove(done, ADMIN)).toBe(false)
    for (const status of ['proposed', 'open', 'reserved', 'confirmed', 'cancelled'] as const)
      expect(canApprove({ ...done, status }, TATA)).toBe(false)
  })

  it('canTakeFree (#195): a brother on an open task only', () => {
    expect(canTakeFree({ status: 'open' }, STARSI)).toBe(true)
    expect(canTakeFree({ status: 'open' }, TATA)).toBe(false)
    expect(canTakeFree({ status: 'open' }, ADMIN)).toBe(false)
    for (const status of ['proposed', 'reserved', 'done_unconfirmed', 'confirmed'] as const)
      expect(canTakeFree({ status }, STARSI)).toBe(false)
  })
  it('Hotovo and Uvolnit only for the brother who reserved it', () => {
    const mine = view({ status: 'reserved', reservedBy: { id: 3, name: 'Starší' } })
    expect(canWorkOn(mine, STARSI)).toBe(true)
    expect(canWorkOn(mine, MLADSI)).toBe(false)
    expect(canWorkOn(mine, TATA)).toBe(false)
    expect(canWorkOn(mine, ADMIN)).toBe(false)
    for (const status of ['open', 'proposed', 'done_unconfirmed', 'confirmed'] as const)
      expect(canWorkOn({ ...mine, status }, STARSI)).toBe(false)
    expect(canWorkOn(view({ status: 'reserved', reservedBy: null }), STARSI)).toBe(false)
  })
})

describe('price change (#36)', () => {
  const TATA = { id: 2, role: 'giver' } as const
  const change = {
    id: 7,
    score: 20,
    proposedBy: { id: 2, name: 'Táta' },
    approvedBy: [{ id: 2, name: 'Táta' }],
    waitingFor: [{ id: 3, name: 'Starší' }],
  }
  const STARSI = { id: 3, role: 'taker' } as const
  const MLADSI = { id: 4, role: 'taker' } as const
  const ADMIN = { id: 1, role: 'admin' } as const
  const reserved = { status: 'reserved' as const, reservedBy: { id: 3, name: 'Starší' } }

  it('canProposeChange: who may start a change in each state', () => {
    const open = { status: 'open' as const, reservedBy: null, scoreChange: null }
    expect(canProposeChange(open, TATA)).toBe(true)
    expect(canProposeChange(open, MLADSI)).toBe(true)
    expect(canProposeChange(open, ADMIN)).toBe(false)
    expect(canProposeChange({ ...reserved, scoreChange: null }, TATA)).toBe(true)
    expect(canProposeChange({ ...reserved, scoreChange: null }, STARSI)).toBe(true)
    expect(canProposeChange({ ...reserved, scoreChange: null }, MLADSI)).toBe(false)
    expect(canProposeChange({ ...open, scoreChange: change }, TATA)).toBe(false)
    for (const status of ['proposed', 'done_unconfirmed', 'confirmed', 'cancelled'] as const) {
      expect(canProposeChange({ ...open, status }, TATA)).toBe(false)
    }
  })

  it('canProposeChange with reopenBidding on: open tasks rebid instead, reserved keep it', () => {
    const open = { status: 'open' as const, reservedBy: null, scoreChange: null }
    expect(canProposeChange(open, TATA, true)).toBe(false)
    expect(canProposeChange(open, MLADSI, true)).toBe(false)
    expect(canProposeChange({ ...reserved, scoreChange: null }, TATA, true)).toBe(true)
  })

  it('changeAnswer: proposer withdraws, who it waits for answers, others nothing', () => {
    expect(changeAnswer({ scoreChange: change }, TATA)).toBe('withdraw')
    expect(changeAnswer({ scoreChange: change }, STARSI)).toBe('answer')
    expect(changeAnswer({ scoreChange: change }, MLADSI)).toBe('none')
    expect(changeAnswer({ scoreChange: null }, STARSI)).toBe('none')
  })

  it('changeHint names who has to agree', () => {
    expect(changeHint(reserved, TATA)).toBe('Stačí souhlas: Starší')
    expect(changeHint(reserved, STARSI)).toBe('Stačí souhlas: rodič')
    expect(changeHint({ status: 'open', reservedBy: null }, TATA)).toBe(cs.taskPrice.needsOpen)
  })
})

describe('waitingOnTakers (GHome "Čeká na kluky", #41)', () => {
  const TATA = { id: 2, role: 'giver' } as const
  const boys = [
    { id: 3, name: 'Starší' },
    { id: 4, name: 'Mladší' },
  ]

  it('keeps offers with no bids that wait only for the boys, in list order', () => {
    const keep = view({ id: 1, waitingFor: boys })
    const alsoKeep = view({ id: 6, waitingFor: [boys[0] ?? { id: 3, name: 'Starší' }] })
    const withBids = view({ id: 2, waitingFor: boys, bids: [b(3, 'Starší', 20)] })
    const waitsForMe = view({ id: 3, waitingFor: [...boys, { id: 2, name: 'Táta' }] })
    const nobody = view({ id: 4, waitingFor: [] })
    const open = view({ id: 5, status: 'open', waitingFor: boys })
    expect(
      waitingOnTakers([keep, withBids, waitsForMe, nobody, open, alsoKeep], TATA).map((t) => t.id),
    ).toEqual([1, 6])
  })
})

describe('instanceMeta (#38)', () => {
  const now = new Date('2026-11-24T17:00:00.000Z') // Tue 18:00 Prague
  it('a deadline instance: its due time', () => {
    const t = view({
      status: 'open',
      origin: 'on_demand',
      templateId: 1,
      dueAt: '2026-11-25T06:00:00.000Z',
      graceEndsAt: '2026-11-25T07:00:00.000Z',
    })
    expect(instanceMeta(t, now)).toBe('do zítra 7:00')
  })
  it('an on-demand one without a deadline: when it was made', () => {
    const t = view({
      status: 'open',
      origin: 'on_demand',
      templateId: 1,
      createdAt: '2026-11-24T14:02:00.000Z',
    })
    expect(instanceMeta(t, now)).toBe('na vyžádání · 15:02')
  })
  it('a scheduled one without a deadline: its slot (#39)', () => {
    const t = view({
      status: 'open',
      origin: 'scheduled',
      templateId: 1,
      createdAt: '2026-11-24T17:00:00.000Z',
    })
    // When first, so a cut-off row keeps it; "dnes"/"včera" so an old one isn't read as next week.
    expect(instanceMeta(t, now)).toBe('dnes 18:00 · podle rozvrhu')
    expect(instanceMeta({ ...t, createdAt: '2026-11-16T06:00:00.000Z' }, now)).toBe(
      'po 16. 11. · podle rozvrhu',
    )
  })
  it('a scheduled one with a deadline: its due time (#39)', () => {
    const t = view({
      status: 'open',
      origin: 'scheduled',
      templateId: 1,
      createdAt: '2026-11-24T17:00:00.000Z',
      dueAt: '2026-11-25T06:00:00.000Z',
      graceEndsAt: '2026-11-25T07:00:00.000Z',
    })
    expect(instanceMeta(t, now)).toBe('do zítra 7:00')
  })
  it('an expired instance: nothing, its Prošlo chip says it (#39)', () => {
    const t = view({
      status: 'expired',
      origin: 'scheduled',
      templateId: 1,
      dueAt: '2026-11-23T06:00:00.000Z',
      graceEndsAt: '2026-11-23T07:00:00.000Z',
    })
    expect(instanceMeta(t, now)).toBeUndefined()
  })
  it('a one-time task or a self-log: nothing', () => {
    expect(instanceMeta(view({ status: 'open' }), now)).toBeUndefined()
    expect(
      instanceMeta(view({ status: 'done_unconfirmed', origin: 'self_logged', templateId: 1 }), now),
    ).toBeUndefined()
  })
})

describe('a reopened round (#212)', () => {
  const STARSI = { id: 3, role: 'taker' } as const
  const TATA = { id: 2, role: 'giver' } as const
  const ADMIN = { id: 1, role: 'admin' } as const
  const tata = { id: 2, name: 'Táta' }
  /** An open one-time task agreed at 18, in a round with this offer and these bids. */
  const round = (
    offer: number,
    offeredBy: { id: number; name: string } | null,
    bids: TaskView['bids'] = [],
    lastBids: TaskView['lastBids'] = [],
  ) =>
    view({
      status: 'open',
      offeredByName: null,
      approvedBy: [],
      approverIds: [],
      bids,
      lastBids,
      lowest: bids[0]
        ? { score: bids[0].score, bidders: [{ id: bids[0].takerId, name: bids[0].name }] }
        : null,
      rebidding: { offer, offeredBy },
    })

  it('the chip says Vyjednává se; a plain open task stays open', () => {
    expect(taskChipState(round(18, null))).toBe('negotiating')
    expect(taskChipState(view({ status: 'open' }))).toBe('open')
  })
  it('no counter: a brother has nothing to say yes to', () => {
    expect(bidButtons(round(18, null), STARSI)).toEqual([])
  })
  it('a counter: Souhlasím and Beru za send the counter, not the agreed score', () => {
    const [approve] = bidButtons(round(16, tata), STARSI)
    expect(approve).toMatchObject({
      action: 'approveOffer',
      data: { taskId: 1, score: 16 },
      hint: cs.rebid.approveHint(16),
    })
    expect(approve?.hint).toBe('Platí nová cena 16 b. Úkol zůstane volný.')
    const mine = bidButtons(round(16, tata, [b(3, 'Starší', 15)]), STARSI)
    expect(mine.map((x) => [x.action, x.data])).toEqual([
      ['acceptOffer', { taskId: 1, score: 16 }],
      ['approveOffer', { taskId: 1, score: 16 }],
    ])
    expect(mine[0]?.label).toBe(cs.bids.take(16))
  })
  it('a bid: the current offer and his last bid are greyed out', () => {
    expect(sendButton(round(16, tata), STARSI, 16)?.disabled).toBe(true)
    expect(sendButton(round(16, tata), STARSI, 18)?.disabled).toBe(false)
    const again = sendButton(round(16, tata, [], [{ takerId: 3, score: 15 }]), STARSI, 15)
    expect(again).toMatchObject({ action: 'placeBid', disabled: true, hint: cs.bids.sameAgainHint })
  })
  it('a parent counters, or accepts the lowest bid', () => {
    expect(sendButton(round(18, null), TATA, 17)?.action).toBe('counterOffer')
    expect(bidButtons(round(18, null, [b(4, 'Mladší', 15)]), TATA)).toEqual([
      expect.objectContaining({
        action: 'acceptLowestTaskBid',
        data: { taskId: 1, score: 15, bidders: [4] },
      }),
    ])
  })
  it('a parent turns a round down only with bids (Jakub 2026-11-25)', () => {
    expect(refuseButton(round(18, null), TATA, true)).toBeNull()
    expect(refuseButton(round(18, null, [b(4, 'Mladší', 15)]), TATA, true)).toMatchObject({
      label: cs.bids.turnDown,
      hint: cs.rebid.turnDownHint(18),
      data: { taskId: 1, bids: [{ takerId: 4, score: 15 }] },
    })
    expect(refuseButton(round(18, null), TATA, false)).toBeNull()
  })
  it('a brother or admin gets no button in a round nobody bid in', () => {
    expect(refuseButton(round(18, null), STARSI, true)).toBeNull()
    expect(refuseButton(round(18, null), ADMIN, true)).toBeNull()
  })
  it('reopen: a free agreed one-time task, any brother or parent, switch on', () => {
    const free = view({ status: 'open', offeredByName: null, approvedBy: [], approverIds: [] })
    for (const me of [TATA, STARSI]) {
      expect(reopenButton(free, me, true)).toMatchObject({
        action: 'reopenBidding',
        data: { taskId: 1 },
        label: cs.rebid.reopen,
        hint: cs.rebid.reopenHint(18),
      })
    }
    const change = {
      id: 5,
      score: 20,
      proposedBy: tata,
      approvedBy: [tata],
      waitingFor: [],
    } as unknown as TaskView['scoreChange']
    for (const [t, me, on] of [
      [free, ADMIN, true],
      [free, STARSI, false],
      [round(18, null), STARSI, true],
      [{ ...free, scoreChange: change }, STARSI, true],
      [{ ...free, status: 'reserved' as const }, STARSI, true],
      [view({}), STARSI, true],
      [{ ...free, status: 'confirmed' as const }, STARSI, true],
      [{ ...free, origin: 'on_demand' as const }, STARSI, true],
    ] as const) {
      expect(reopenButton(t, me, on)).toBeNull()
    }
  })
  it('header lines: the counter, then the agreed score that still applies', () => {
    expect(roundLines(round(16, tata))).toEqual(['Táta nabízí 16 b', cs.taskPrice.oldStays(18)])
    expect(roundLines(round(18, null))).toEqual([cs.taskPrice.oldStays(18)])
    expect(roundLines(view({ status: 'open' }))).toEqual([])
  })
  it('toasts in a round: the call decides, as the task stays open', () => {
    const turnDown = (bids: { takerId: number; score: number }[]): BidCall => ({
      action: 'turnDownBids',
      data: { taskId: 1, bids },
    })
    const counter = (bidders: number[]): BidCall => ({
      action: 'counterOffer',
      data: { taskId: 1, score: 15, bidders },
    })
    expect(toastFor(turnDown([{ takerId: 4, score: 15 }]), 'open', TATA, true)).toBe(
      cs.bids.toast.turnedDown,
    )
    expect(toastFor(call('reopenBidding'), 'open', STARSI, false)).toBe(cs.rebid.toast.reopened)
    expect(toastFor(call('placeBid'), 'open', STARSI, true)).toBe(cs.bids.toast.sent)
    expect(toastFor(call('withdrawBid'), 'open', STARSI, true)).toBe(cs.bids.toast.withdrawn)
    expect(toastFor(counter([]), 'open', TATA, true)).toBe(cs.bids.toast.sent)
    expect(toastFor(counter([4]), 'reserved', TATA, true)).toBe(cs.bids.toast.agreed)
    expect(toastFor(call('acceptOffer'), 'reserved', STARSI, true)).toBe(cs.bids.toast.agreedMine)
    expect(toastFor(call('approveOffer'), 'open', STARSI, true)).toBe(cs.bids.toast.agreed)
    // Not in a round: as before.
    expect(toastFor(call('placeBid'), 'proposed', STARSI, false)).toBe(cs.bids.toast.sent)
    expect(toastFor(call('approveOffer'), 'proposed', STARSI, false)).toBe(cs.tasks.approved)
  })
})
