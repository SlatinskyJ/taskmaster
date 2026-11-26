import { describe, expect, it } from 'vitest'
import type { Me } from '~/components/tasks/taskView'
import { cs } from '~/lib/strings'
import type { TemplateView } from '~/server/templates/functions'
import {
  priceButtons,
  priceError,
  priceRefusal,
  priceMeta,
  priceSend,
  priceToast,
  stepperStart,
  templateChip,
} from './priceView'

// What the template price page offers and sends (spec §5.1, runs like bidding §5.2). Demo
// numbers: "Vyndat myčku" agreed at 3, Mladší bids 5, Táta offers 4.

const TATA: Me = { id: 2, role: 'giver' }
const MAMA: Me = { id: 3, role: 'giver' }
const STARSI: Me = { id: 4, role: 'taker' }
const MLADSI: Me = { id: 5, role: 'taker' }
const ADMIN: Me = { id: 1, role: 'admin' }

const base: TemplateView = {
  id: 7,
  title: 'Vyndat myčku',
  status: 'active',
  score: 3,
  approvalRequired: true,
  createdByName: 'Táta',
  approvedBy: [],
  schedule: null,
  deadline: null,
  bidding: null,
  lastBids: [],
  change: null,
}
const demo: TemplateView = {
  ...base,
  change: {
    offer: { score: 4, byName: 'Táta' },
    bids: [{ takerId: MLADSI.id, name: 'Mladší', score: 5 }],
    lowest: 5,
  },
}
const onlyBids: TemplateView = {
  ...base,
  change: { offer: null, bids: [{ takerId: MLADSI.id, name: 'Mladší', score: 5 }], lowest: 5 },
}
const tie: TemplateView = {
  ...base,
  change: {
    offer: null,
    bids: [
      { takerId: STARSI.id, name: 'Starší', score: 5 },
      { takerId: MLADSI.id, name: 'Mladší', score: 5 },
    ],
    lowest: 5,
  },
}
const proposed: TemplateView = { ...base, status: 'proposed', approvedBy: ['Táta'] }

const labels = (t: TemplateView, me: Me) =>
  priceButtons(t, me).map((b) => [
    b.action,
    'score' in b.data ? b.data.score : null,
    b.label,
    b.hint,
  ])

describe('priceButtons', () => {
  it('a brother may accept the parents’ offer, with or without his own bid', () => {
    const accept = ['acceptOffer', 4, 'Přijmout 4', 'Nové úkoly budou za tolik bodů.']
    expect(labels(demo, STARSI)).toEqual([accept])
    expect(labels(demo, MLADSI)).toEqual([accept])
  })

  it('a parent may accept the lowest bid, sending that number', () => {
    const accept = ['acceptBid', 5, 'Přijmout 5 (Mladší)', 'Nové úkoly budou za tolik bodů.']
    expect(labels(demo, TATA)).toEqual([accept])
    expect(labels(demo, MAMA)).toEqual([accept])
  })

  it('a tie at the lowest names every bidder', () => {
    expect(labels(tie, TATA)[0]?.[2]).toBe('Přijmout 5 (Starší, Mladší)')
  })

  it('nothing to accept: no change yet, a proposed template, the admin', () => {
    expect(priceButtons(base, STARSI)).toEqual([])
    expect(priceButtons(base, TATA)).toEqual([])
    expect(priceButtons(onlyBids, STARSI)).toEqual([])
    expect(priceButtons(proposed, TATA)).toEqual([])
    expect(priceButtons(demo, ADMIN)).toEqual([])
  })
})

const send = (t: TemplateView, me: Me, value: number) => {
  const s = priceSend(t, me, value)
  return s && [s.action, s.data.score, s.label, s.hint, s.disabled]
}

describe('priceSend', () => {
  it('a parent at the lowest bid accepts it; above or below it is a plain offer', () => {
    const hint = 'Nové úkoly budou za tolik bodů.'
    expect(send(demo, TATA, 5)).toEqual(['counter', 5, 'Přijmout 5 (Mladší)', hint, false])
    const offer = (n: number) => ['counter', n, 'Nabídnout', 'Nová nabídka pro všechny.', false]
    expect(send(demo, TATA, 6)).toEqual(offer(6))
    expect(send(demo, TATA, 2)).toEqual(offer(2))
  })

  it('a parent may not send the score or the open offer', () => {
    expect(send(demo, TATA, 3)?.[4]).toBe(true)
    expect(send(demo, TATA, 4)?.[4]).toBe(true)
  })

  it('a brother bids; not his own bid, the offer or the score', () => {
    expect(send(demo, MLADSI, 6)).toEqual(['bid', 6, 'Nabídnout', 'Nabídka půjde rodičům.', false])
    for (const n of [3, 4, 5]) expect(send(demo, MLADSI, n)?.[4]).toBe(true)
  })

  it('no change yet: anyone may start one', () => {
    expect(send(base, STARSI, 3)?.[4]).toBe(true)
    expect(send(base, STARSI, 5)).toEqual(['bid', 5, 'Nabídnout', 'Nabídka půjde rodičům.', false])
    expect(send(base, TATA, 5)).toEqual([
      'counter',
      5,
      'Nabídnout',
      'Nová nabídka pro všechny.',
      false,
    ])
  })

  it('nothing for a proposed template or the admin', () => {
    expect(priceSend(proposed, TATA, 5)).toBeNull()
    expect(priceSend(demo, ADMIN, 5)).toBeNull()
  })
})

describe('stepperStart', () => {
  it('his own bid, else the offer, else the score', () => {
    expect(stepperStart(demo, MLADSI)).toBe(5)
    expect(stepperStart(demo, STARSI)).toBe(4)
    expect(stepperStart(demo, TATA)).toBe(4)
    expect(stepperStart(base, STARSI)).toBe(3)
  })
})

describe('priceMeta', () => {
  it('by role: a brother reads the offer, a parent the bids he must answer', () => {
    expect(priceMeta(demo, STARSI)).toBe('Táta nabízí 4')
    expect(priceMeta(demo, TATA)).toBe('Mladší chce 5')
    expect(priceMeta(tie, TATA)).toBe('Starší, Mladší chtějí 5')
  })

  it('falls back to the other side, else nothing', () => {
    expect(priceMeta(onlyBids, STARSI)).toBe('Mladší chce 5')
    expect(
      priceMeta(
        { ...base, change: { offer: { score: 4, byName: 'Táta' }, bids: [], lowest: null } },
        TATA,
      ),
    ).toBe('Táta nabízí 4')
    expect(priceMeta(base, STARSI)).toBeNull()
  })
})

describe('priceToast', () => {
  const ok = (score: number) => ({ ok: true as const, id: 7, score, status: 'active' as const })
  const call = (action: 'bid' | 'counter' | 'acceptBid' | 'acceptOffer', score: number) => ({
    action,
    data: { templateId: 7, score },
  })

  it('"Domluveno" only when the number sent is now the score', () => {
    expect(priceToast(call('acceptOffer', 4), ok(4))).toBe('Domluveno')
    expect(priceToast(call('counter', 5), ok(5))).toBe('Domluveno')
    expect(priceToast(call('bid', 6), ok(3))).toBe('Nabídka odeslána')
    expect(priceToast(call('counter', 6), ok(3))).toBe('Nabídka odeslána')
  })

  it('a change someone else agreed meanwhile does not read as mine', () => {
    // The page showed 3; Starší accepted 4 meanwhile; Mladší's bid of 6 only opens a new change.
    expect(priceToast(call('bid', 6), ok(4))).toBe('Nabídka odeslána')
    // An agreed chore: a bid the server takes at the number sent agrees (§5.1 score change).
    expect(priceToast(call('bid', 4), ok(4))).toBe('Domluveno')
  })
})

describe('templateChip', () => {
  it('proposed, a change in flight, or agreed', () => {
    expect(templateChip(proposed)).toEqual({ state: 'proposed' })
    expect(templateChip(demo)).toEqual({ state: 'negotiating' })
    expect(templateChip(base)).toEqual({ state: 'confirmed', label: 'Platí' })
  })
})

// A proposed chore's first price (#209): "Vynést koš", offered by Táta at 10, Starší bids 12.
describe('a proposed chore with first-price bidding (#209)', () => {
  const bidding = (
    bids: { takerId: number; name: string; score: number }[],
    lastBids = bids.map((b) => ({ takerId: b.takerId, score: b.score })),
  ): TemplateView => ({
    ...base,
    title: 'Vynést koš',
    status: 'proposed',
    score: 10,
    approvedBy: ['Táta'],
    bidding: {
      offer: { score: 10, byName: 'Táta' },
      bids: [...bids].sort((a, b) => a.score - b.score),
      lowest: bids.length ? Math.min(...bids.map((b) => b.score)) : null,
      lastBids,
    },
  })
  const starsi12 = { takerId: STARSI.id, name: 'Starší', score: 12 }
  const one = bidding([starsi12])
  const none = bidding([])

  it('a brother agrees to the offer; with his bid he may also say Nechci', () => {
    const agree = ['approve', 10, 'Souhlasím', 'Úkol začne platit za 10 b.']
    expect(labels(one, STARSI)).toEqual([agree])
    expect(labels(one, MLADSI)).toEqual([agree])
    expect(priceRefusal(one, STARSI)).toMatchObject({
      action: 'withdraw',
      data: { templateId: 7 },
      label: 'Nechci',
    })
    expect(priceRefusal(one, MLADSI)).toBeNull()
  })

  it('a brother cannot send the offer or his last bid again', () => {
    expect(priceSend(one, STARSI, 10)?.disabled).toBe(true)
    expect(priceSend(one, STARSI, 12)).toMatchObject({
      action: 'bid',
      disabled: true,
      hint: 'Stejné číslo můžeš poslat znovu, až rodiče změní nabídku.',
    })
    // After Nechci his bid is closed but still his last one.
    const withdrawn = bidding([], [{ takerId: STARSI.id, score: 12 }])
    expect(priceSend(withdrawn, STARSI, 12)?.disabled).toBe(true)
    expect(priceSend(withdrawn, STARSI, 11)).toMatchObject({
      disabled: false,
      hint: 'Nabídka půjde rodičům.',
    })
    // Only his own last bid is blocked: Mladší may match Starší's 12.
    expect(priceSend(one, MLADSI, 12)).toMatchObject({
      disabled: false,
      hint: 'Nabídka půjde rodičům.',
    })
    const sinceStarsi = bidding([starsi12], [{ takerId: STARSI.id, score: 12 }])
    expect(priceSend(sinceStarsi, MLADSI, 12)?.disabled).toBe(false)
    expect(stepperStart(one, STARSI)).toBe(12)
    expect(stepperStart(one, MLADSI)).toBe(10)
  })

  it('a parent accepts the lowest or turns down exactly the bids he sees', () => {
    const two = bidding([starsi12, { takerId: MLADSI.id, name: 'Mladší', score: 14 }])
    expect(labels(two, TATA)).toEqual([
      ['acceptBid', 12, 'Přijmout 12 (Starší)', 'Úkol začne platit za 12 b.'],
    ])
    expect(priceRefusal(two, TATA)).toEqual({
      key: 'turnDown',
      action: 'turnDown',
      data: {
        templateId: 7,
        bids: [
          { takerId: STARSI.id, score: 12 },
          { takerId: MLADSI.id, score: 14 },
        ],
      },
      label: 'Odmítnout nabídky',
      hint: 'Všechny nabídky se uzavřou. Úkol zůstane navržený za 10 b.',
    })
    const tie = bidding([starsi12, { takerId: MLADSI.id, name: 'Mladší', score: 12 }])
    expect(labels(tie, MAMA)[0]?.[2]).toBe('Přijmout 12')
  })

  it("a parent's stepper at a bid accepts that bid and names its bidder", () => {
    const two = bidding([starsi12, { takerId: MLADSI.id, name: 'Mladší', score: 14 }])
    expect(priceSend(two, TATA, 12)).toMatchObject({
      action: 'counter',
      label: 'Přijmout 12 (Starší)',
    })
    expect(priceSend(two, TATA, 14)).toMatchObject({
      action: 'counter',
      label: 'Přijmout 14 (Mladší)',
      hint: 'Úkol začne platit za 14 b.',
    })
    expect(priceSend(two, TATA, 11)).toMatchObject({ label: 'Nabídnout', disabled: false })
    expect(priceSend(two, TATA, 10)?.disabled).toBe(true)
    const tie = bidding([starsi12, { takerId: MLADSI.id, name: 'Mladší', score: 12 }])
    expect(priceSend(tie, TATA, 12)?.label).toBe('Přijmout 12 (Starší, Mladší)')
  })

  it('a parent with no bids has no yes and no turn-down, the proposer no Souhlasím', () => {
    expect(priceButtons(none, TATA)).toEqual([])
    expect(priceButtons(none, MAMA)).toEqual([])
    expect(priceRefusal(none, TATA)).toBeNull()
  })

  it('chip and short line follow the bids', () => {
    expect(templateChip(one)).toEqual({ state: 'negotiating' })
    expect(templateChip(none)).toEqual({ state: 'proposed' })
    expect(priceMeta(one, TATA)).toBe('Starší chce 12')
    expect(priceMeta(one, STARSI)).toBe('Táta nabízí 10')
  })

  it('switch off (bidding null): nothing to do on the page', () => {
    const off: TemplateView = { ...one, bidding: null }
    for (const me of [TATA, STARSI]) {
      expect(priceButtons(off, me)).toEqual([])
      expect(priceRefusal(off, me)).toBeNull()
      expect(priceSend(off, me, 11)).toBeNull()
    }
    expect(templateChip(off)).toEqual({ state: 'proposed' })
  })

  it('an admin can do nothing', () => {
    expect(priceButtons(one, ADMIN)).toEqual([])
    expect(priceRefusal(one, ADMIN)).toBeNull()
    expect(priceSend(one, ADMIN, 11)).toBeNull()
  })

  it('toasts: sent until the chore is active; withdrawn; turned down', () => {
    const res = (score: number, status: 'proposed' | 'active') => ({
      ok: true as const,
      id: 7,
      score,
      status,
    })
    const at = (action: 'counter' | 'approve' | 'acceptBid', score: number) => ({
      action,
      data: { templateId: 7, score },
    })
    expect(priceToast(at('counter', 11), res(11, 'proposed'), true)).toBe('Nabídka odeslána')
    expect(priceToast(at('approve', 10), res(10, 'proposed'), true)).toBe('Nabídka odeslána')
    expect(priceToast(at('acceptBid', 12), res(12, 'active'), true)).toBe('Domluveno')
    // Stale: the chore went active before the call landed, so it ran as a score change.
    expect(priceToast(at('counter', 11), res(10, 'active'), true)).toBe('Nabídka odeslána')
    const bid = { action: 'bid' as const, data: { templateId: 7, score: 12 } }
    expect(priceToast(bid, res(12, 'active'), true)).toBe('Nabídka odeslána')
    expect(
      priceToast({ action: 'withdraw', data: { templateId: 7 } }, res(10, 'proposed'), true),
    ).toBe('Nabídka stažena')
    const down = { action: 'turnDown' as const, data: { templateId: 7, bids: [] } }
    expect(priceToast(down, res(10, 'proposed'), true)).toBe('Nabídky odmítnuty')
    expect(priceError(down)('offer_changed')).toBe('Mezitím přišla nová nabídka. Podívej se na ni.')
    expect(priceError(down)('not_found')).not.toBe('Mezitím přišla nová nabídka. Podívej se na ni.')
    expect(priceError(at('counter', 11))('offer_changed')).not.toBe(
      'Mezitím přišla nová nabídka. Podívej se na ni.',
    )
  })
})

describe('Nechci, turn-down and the same number on a price change (#232)', () => {
  // "Umýt koupelnu" agreed at 10: Starší bids 12, Mladší 13; no parents' offer.
  const mladsi13 = { takerId: MLADSI.id, name: 'Mladší', score: 13 }
  const change: TemplateView = {
    ...base,
    score: 10,
    change: {
      offer: null,
      bids: [{ takerId: STARSI.id, name: 'Starší', score: 12 }, mladsi13],
      lowest: 12,
    },
    lastBids: [
      { takerId: STARSI.id, score: 12 },
      { takerId: MLADSI.id, score: 13 },
    ],
  }

  it('a brother with a bid in a change gets Nechci; refusals off: none', () => {
    expect(priceRefusal(change, STARSI, true)).toEqual({
      key: 'withdraw',
      action: 'withdraw',
      data: { templateId: 7 },
      label: cs.bids.withdraw,
      hint: cs.bids.withdrawHint,
    })
    expect(priceRefusal(change, STARSI)).toBeNull()
    expect(priceRefusal(change, STARSI, false)).toBeNull()
    const noBid = { ...change, change: { offer: null, bids: [], lowest: null } }
    expect(priceRefusal(noBid, STARSI, true)).toBeNull()
  })

  it('a parent with bids and an offer turns down exactly the bids shown; the offer stays', () => {
    const withOffer = {
      ...change,
      change: { bids: change.change?.bids ?? [], lowest: 12, offer: { score: 11, byName: 'Máma' } },
    }
    expect(priceRefusal(withOffer, TATA, true)).toEqual({
      key: 'turnDown',
      action: 'turnDown',
      data: {
        templateId: 7,
        bids: [
          { takerId: STARSI.id, score: 12 },
          { takerId: MLADSI.id, score: 13 },
        ],
      },
      label: cs.bids.turnDown,
      hint: cs.bids.turnDownChangeHint(10, 11),
    })
    // No parents' offer: nothing to turn down to, no button (Jakub 2026-11-26).
    expect(priceRefusal(change, TATA, true)).toBeNull()
    const offer = { score: 11, byName: 'Táta' }
    const offerOnly = { ...change, change: { offer, bids: [], lowest: null } }
    expect(priceRefusal(offerOnly, TATA, true)).toBeNull()
    expect(priceRefusal(base, TATA, true)).toBeNull()
    expect(priceRefusal(withOffer, ADMIN, true)).toBeNull()
    expect(priceRefusal(withOffer, TATA, false)).toBeNull()
    expect(priceRefusal(withOffer, TATA)).toBeNull()
  })

  it('a proposed chore keeps Nechci and Odmítnout nabídky with refusals off (#209)', () => {
    const first: TemplateView = {
      ...proposed,
      score: 10,
      bidding: {
        offer: { score: 10, byName: 'Táta' },
        bids: [{ takerId: STARSI.id, name: 'Starší', score: 12 }],
        lowest: 12,
        lastBids: [{ takerId: STARSI.id, score: 12 }],
      },
    }
    expect(priceRefusal(first, STARSI, false)?.action).toBe('withdraw')
    expect(priceRefusal(first, TATA, false)?.action).toBe('turnDown')
  })

  it("a brother's stepper is greyed at his last bid with the same-again hint", () => {
    const withdrawn: TemplateView = {
      ...change,
      change: { offer: null, bids: [mladsi13], lowest: 13 },
    }
    expect(priceSend(withdrawn, STARSI, 12)).toMatchObject({
      disabled: true,
      hint: cs.bids.sameAgainHint,
    })
    // Mladší's number is open to Starší; Starší's own 12 is open to Mladší.
    expect(priceSend(withdrawn, STARSI, 13)).toMatchObject({
      disabled: false,
      hint: cs.bids.bidHint,
    })
    expect(priceSend(withdrawn, MLADSI, 12)).toMatchObject({ disabled: false })
    // No change in flight: the last bid still counts until bids reset.
    expect(priceSend({ ...base, score: 10, lastBids: change.lastBids }, STARSI, 12)).toMatchObject({
      disabled: true,
      hint: cs.bids.sameAgainHint,
    })
  })

  it('toasts on an agreed chore: withdrawn, turned down, a stale turn-down', () => {
    const kept = { ok: true as const, id: 7, score: 10, status: 'active' as const }
    expect(priceToast({ action: 'withdraw', data: { templateId: 7 } }, kept)).toBe(
      cs.bids.toast.withdrawn,
    )
    const down = { action: 'turnDown' as const, data: { templateId: 7, bids: [] } }
    expect(priceToast(down, kept)).toBe(cs.bids.toast.turnedDown)
    expect(priceError(down)('offer_changed')).toBe(cs.bids.turnDownChanged)
  })
})
