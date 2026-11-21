import { describe, expect, it } from 'vitest'
import type { Me } from '~/components/tasks/taskView'
import type { TemplateView } from '~/server/templates/functions'
import {
  priceButtons,
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
  priceButtons(t, me).map((b) => [b.action, b.data.score, b.label, b.hint])

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
  const ok = (score: number) => ({ ok: true as const, id: 7, score })
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
  })
})

describe('templateChip', () => {
  it('proposed, a change in flight, or agreed', () => {
    expect(templateChip(proposed)).toEqual({ state: 'proposed' })
    expect(templateChip(demo)).toEqual({ state: 'negotiating' })
    expect(templateChip(base)).toEqual({ state: 'confirmed', label: 'Platí' })
  })
})
