import { describe, expect, it } from 'vitest'
import type { AgreementError, OneTimeAgreement } from './agreement'
import { approveOneTimeOffer, createOneTimeTask, resolveOneTime } from './agreement'
import {
  acceptLowestBid,
  acceptOneTimeOffer,
  counterOneTimeOffer,
  placeOneTimeBid,
} from './bidding'
import { EMPTY_BOOK, lowestBid, placeBid, pruneBook } from './bids'
import type { Person } from './parties'
import type { Result } from './result'

// The family (spec §3). Mum may join later.
const DAD = 1
const OLDER = 2
const YOUNGER = 3
const JAKUB = 4
const MUM = 5

const family: Person[] = [
  { id: DAD, role: 'giver', active: true },
  { id: OLDER, role: 'taker', active: true },
  { id: YOUNGER, role: 'taker', active: true },
  { id: JAKUB, role: 'admin', active: true },
]
const withMum: Person[] = [...family, { id: MUM, role: 'giver', active: true }]
const deactivate = (people: Person[], id: number) =>
  people.map((p) => (p.id === id ? { ...p, active: false } : p))

function value<T>(result: Result<T, AgreementError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}
function error<T>(result: Result<T, AgreementError>): AgreementError {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

// Umýt auto: Dad offers 30.
const carWash = (people: Person[] = family): OneTimeAgreement =>
  value(createOneTimeTask(people, DAD, 30))
const bid = (t: OneTimeAgreement, who: number, score: number, people: Person[] = family) =>
  value(placeOneTimeBid(t, people, who, score))
const proposed = (t: OneTimeAgreement) => {
  if (t.status !== 'proposed') throw new Error('expected proposed')
  return t
}

describe('bids (spec §5.2 path 2)', () => {
  it('a brother bids a different score; the task stays proposed', () => {
    const t = proposed(bid(carWash(), OLDER, 25))
    expect(t.book.bids).toEqual([{ by: OLDER, score: 25 }])
  })

  it('bidding again replaces his own open bid, as often as he likes', () => {
    const t = proposed(bid(bid(bid(carWash(), OLDER, 25), OLDER, 23), OLDER, 24))
    expect(t.book.bids).toEqual([{ by: OLDER, score: 24 }])
  })

  it('both brothers bid at once, each with one open bid', () => {
    const t = proposed(bid(bid(bid(carWash(), OLDER, 25), YOUNGER, 27), OLDER, 23))
    expect(t.book.bids).toEqual([
      { by: YOUNGER, score: 27 },
      { by: OLDER, score: 23 },
    ])
  })

  it('only an active taker bids', () => {
    for (const who of [DAD, JAKUB]) {
      expect(error(placeOneTimeBid(carWash(), family, who, 25))).toBe('not_a_taker')
    }
    const noOlder = deactivate(family, OLDER)
    expect(error(placeOneTimeBid(carWash(), noOlder, OLDER, 25))).toBe('not_a_taker')
  })

  it('a bid must be a whole number from 1', () => {
    for (const score of [0, -5, 2.5, Number.NaN]) {
      expect(error(placeOneTimeBid(carWash(), family, OLDER, score))).toBe('invalid_score')
    }
  })

  it('bidding the current offer or his own bid again is refused', () => {
    expect(error(placeOneTimeBid(carWash(), family, OLDER, 30))).toBe('same_score')
    expect(error(placeOneTimeBid(bid(carWash(), OLDER, 25), family, OLDER, 25))).toBe('same_score')
  })
})

const counter = (t: OneTimeAgreement, who: number, score: number, people: Person[] = family) =>
  value(counterOneTimeOffer(t, people, who, score, []))

describe('counters (Jakub 2026-11-17): one new offer to every taker', () => {
  it("a giver's counter replaces the offer for both brothers; bids stay", () => {
    const t = proposed(counter(bid(bid(carWash(), OLDER, 40), YOUNGER, 38), DAD, 34))
    expect(t.offer).toEqual({ score: 34, proposedBy: DAD, approvedBy: [DAD] })
    expect(t.book.bids).toEqual([
      { by: OLDER, score: 40 },
      { by: YOUNGER, score: 38 },
    ])
  })

  it('either brother who bid may accept the counter: reserved to him', () => {
    const t = counter(bid(bid(carWash(), OLDER, 40), YOUNGER, 38), DAD, 34)
    for (const who of [OLDER, YOUNGER]) {
      expect(value(acceptOneTimeOffer(t, family, who, 34))).toEqual({
        status: 'reserved',
        score: 34,
        takerId: who,
        giverId: DAD,
      })
    }
  })

  it('a brother without a bid approves the counter instead: open for both', () => {
    const t = counter(bid(carWash(), OLDER, 40), DAD, 34)
    expect(error(acceptOneTimeOffer(t, family, YOUNGER, 34))).toBe('no_bid')
    expect(value(approveOneTimeOffer(t, family, YOUNGER))).toEqual({ status: 'open', score: 34 })
  })

  it('approvals of the old offer are gone after a counter', () => {
    let t = bid(carWash(withMum), OLDER, 40, withMum)
    t = value(approveOneTimeOffer(t, withMum, MUM))
    t = counter(t, DAD, 34, withMum)
    expect(proposed(t).offer.approvedBy).toEqual([DAD])
  })

  it('[call] Mum may counter; she is then the agreeing giver', () => {
    const t = counter(bid(carWash(withMum), OLDER, 40, withMum), MUM, 35, withMum)
    const r = value(acceptOneTimeOffer(t, withMum, OLDER, 35))
    expect(r).toEqual({ status: 'reserved', score: 35, takerId: OLDER, giverId: MUM })
  })

  it('a brother may re-bid after a counter, but not the counter itself', () => {
    const t = counter(bid(carWash(), OLDER, 40), DAD, 34)
    expect(proposed(bid(t, OLDER, 36)).book.bids).toEqual([{ by: OLDER, score: 36 }])
    expect(error(placeOneTimeBid(t, family, OLDER, 34))).toBe('same_score')
  })

  it('needs an active giver, a whole score from 1 and a new number', () => {
    const t = bid(carWash(), OLDER, 40)
    for (const who of [OLDER, JAKUB]) {
      expect(error(counterOneTimeOffer(t, family, who, 34, []))).toBe('not_a_giver')
    }
    expect(error(counterOneTimeOffer(t, family, DAD, 0, []))).toBe('invalid_score')
    expect(error(counterOneTimeOffer(t, family, DAD, 30, []))).toBe('same_score')
  })

  it('a giver may change the offer before anyone bid (decision 8a)', () => {
    expect(value(counterOneTimeOffer(carWash(), family, DAD, 25, []))).toMatchObject({
      status: 'proposed',
      offer: { score: 25, proposedBy: DAD },
    })
  })

  it("a counter at a bid's own number accepts that bid, lowest or not (decision 8b)", () => {
    const t = bid(bid(carWash(), OLDER, 40), YOUNGER, 36)
    expect(value(counterOneTimeOffer(t, family, DAD, 40, [OLDER]))).toEqual({
      status: 'reserved',
      score: 40,
      takerId: OLDER,
      giverId: DAD,
    })
    expect(value(counterOneTimeOffer(t, family, DAD, 36, [YOUNGER]))).toEqual({
      status: 'reserved',
      score: 36,
      takerId: YOUNGER,
      giverId: DAD,
    })
    expect(value(counterOneTimeOffer(t, family, DAD, 35, []))).toMatchObject({ status: 'proposed' })
    expect(value(counterOneTimeOffer(t, family, DAD, 37, []))).toMatchObject({ status: 'proposed' })
  })

  it("[call] Mum's counter at a bid's number makes her the agreeing giver (decision 8b)", () => {
    const t = bid(carWash(withMum), OLDER, 40, withMum)
    expect(value(counterOneTimeOffer(t, withMum, MUM, 40, [OLDER]))).toEqual({
      status: 'reserved',
      score: 40,
      takerId: OLDER,
      giverId: MUM,
    })
  })

  it('a counter at a number several takers bid opens the task at it (decision 8b, tie rule)', () => {
    const t = bid(bid(carWash(), OLDER, 36), YOUNGER, 36)
    expect(value(counterOneTimeOffer(t, family, DAD, 36, [OLDER, YOUNGER]))).toEqual({
      status: 'open',
      score: 36,
    })
  })

  it('a counter names the takers the giver saw at that number; a different set is offer_changed (Rules, plan round 2)', () => {
    const lone = bid(carWash(), OLDER, 25)
    expect(error(counterOneTimeOffer(lone, family, DAD, 25, []))).toBe('offer_changed') // he re-priced to 25 for everyone, Older bid 25 meanwhile
    expect(error(counterOneTimeOffer(carWash(), family, DAD, 25, [OLDER]))).toBe('offer_changed') // the bid he saw is gone
    const tie = bid(lone, YOUNGER, 25)
    expect(error(counterOneTimeOffer(tie, family, DAD, 25, [OLDER]))).toBe('offer_changed') // Younger joined at 25
    expect(value(counterOneTimeOffer(tie, family, DAD, 25, [YOUNGER, OLDER]))).toEqual({
      status: 'open',
      score: 25,
    })
  })

  it("a replaced bid's old number is not a bid any more", () => {
    const t = bid(bid(carWash(), OLDER, 40), OLDER, 38)
    expect(value(counterOneTimeOffer(t, family, DAD, 40, []))).toMatchObject({ status: 'proposed' })
  })
})

describe('a brother accepts the offer (spec §5.2): agreed + reserved in one step', () => {
  it("with no counter, accepts the task's offer from the giver who made it", () => {
    const t = bid(carWash(withMum), OLDER, 20, withMum)
    expect(value(acceptOneTimeOffer(t, withMum, OLDER, 30))).toEqual({
      status: 'reserved',
      score: 30,
      takerId: OLDER,
      giverId: DAD,
    })
  })

  it('needs his own open bid; without one he approves the offer instead (path 1)', () => {
    expect(error(acceptOneTimeOffer(carWash(), family, OLDER, 30))).toBe('no_bid')
    expect(error(acceptOneTimeOffer(bid(carWash(), OLDER, 20), family, YOUNGER, 30))).toBe('no_bid')
  })

  it('only an active taker accepts', () => {
    const t = bid(carWash(withMum), OLDER, 20, withMum)
    expect(error(acceptOneTimeOffer(t, withMum, DAD, 30))).toBe('not_a_taker')
    expect(error(acceptOneTimeOffer(t, withMum, JAKUB, 30))).toBe('not_a_taker')
  })
})

describe('the giver side accepts the lowest open bid (spec §5.2)', () => {
  it('one lowest bidder: reserved to him at his bid', () => {
    const t = bid(bid(bid(carWash(), OLDER, 25), YOUNGER, 27), OLDER, 23)
    expect(value(acceptLowestBid(t, family, DAD, 23, [OLDER]))).toEqual({
      status: 'reserved',
      score: 23,
      takerId: OLDER,
      giverId: DAD,
    })
  })

  it('a tie at the lowest: open at that score, the brothers sort it out', () => {
    const t = bid(bid(carWash(), OLDER, 24), YOUNGER, 24)
    expect(value(acceptLowestBid(t, family, DAD, 24, [OLDER, YOUNGER]))).toEqual({
      status: 'open',
      score: 24,
    })
  })

  it('bids above the offer are normal; the lowest taker bid wins, the offer is not a bid', () => {
    const t = bid(bid(carWash(), YOUNGER, 35), OLDER, 38)
    expect(value(acceptLowestBid(t, family, DAD, 35, [YOUNGER]))).toMatchObject({
      score: 35,
      takerId: YOUNGER,
    })
  })

  it('nothing is agreed until someone accepts: bids alone leave it proposed', () => {
    const t = bid(bid(carWash(), OLDER, 35), YOUNGER, 38)
    expect(t.status).toBe('proposed')
    expect(resolveOneTime(t, family)).toBe(t)
  })

  it('[call] Mum may accept', () => {
    const t = bid(carWash(withMum), YOUNGER, 22, withMum)
    expect(value(acceptLowestBid(t, withMum, MUM, 22, [YOUNGER]))).toMatchObject({
      takerId: YOUNGER,
      giverId: MUM,
    })
  })

  it('needs an active giver and at least one bid', () => {
    const t = bid(carWash(), OLDER, 25)
    for (const who of [OLDER, JAKUB])
      expect(error(acceptLowestBid(t, family, who, 25, [OLDER]))).toBe('not_a_giver')
    expect(error(acceptLowestBid(carWash(), family, DAD, 25, [OLDER]))).toBe('no_bids')
  })

  it("a deactivated brother's bid does not count", () => {
    const t = bid(bid(carWash(), OLDER, 20), YOUNGER, 25)
    const noOlder = deactivate(family, OLDER)
    expect(value(acceptLowestBid(t, noOlder, DAD, 25, [YOUNGER]))).toMatchObject({
      score: 25,
      takerId: YOUNGER,
    })
    const noBrothers = deactivate(noOlder, YOUNGER)
    expect(error(acceptLowestBid(t, noBrothers, DAD, 25, [YOUNGER]))).toBe('no_bids')
  })
})

describe('an accept pins the number the person saw', () => {
  it('a taker accepting 34 after Mum countered 32 is refused; accepting 32 works', () => {
    const t = counter(
      counter(bid(carWash(withMum), OLDER, 40, withMum), DAD, 34, withMum),
      MUM,
      32,
      withMum,
    )
    expect(error(acceptOneTimeOffer(t, withMum, OLDER, 34))).toBe('offer_changed')
    expect(value(acceptOneTimeOffer(t, withMum, OLDER, 32))).toMatchObject({
      score: 32,
      giverId: MUM,
    })
  })

  it('a giver accepting 22 from Younger after the brothers swapped places is refused', () => {
    // Younger 22, Older 25; then Older re-bids 22 and Younger 24: the lowest is still 22, but Older's.
    const t = bid(bid(bid(bid(carWash(), YOUNGER, 22), OLDER, 25), OLDER, 22), YOUNGER, 24)
    expect(error(acceptLowestBid(t, family, DAD, 22, [YOUNGER]))).toBe('offer_changed')
    expect(value(acceptLowestBid(t, family, DAD, 22, [OLDER]))).toMatchObject({
      status: 'reserved',
      takerId: OLDER,
    })
  })

  it('a giver accepting 22 from Younger after Older tied at 22 is refused; the tie he sees is accepted', () => {
    const t = bid(bid(bid(carWash(), YOUNGER, 22), OLDER, 25), OLDER, 22)
    expect(error(acceptLowestBid(t, family, DAD, 22, [YOUNGER]))).toBe('offer_changed')
    expect(value(acceptLowestBid(t, family, DAD, 22, [YOUNGER, OLDER]))).toEqual({
      status: 'open',
      score: 22,
    })
  })

  it('a giver accepting a tie after one brother left it is refused', () => {
    const t = bid(bid(bid(carWash(), YOUNGER, 22), OLDER, 22), OLDER, 24)
    expect(error(acceptLowestBid(t, family, DAD, 22, [OLDER, YOUNGER]))).toBe('offer_changed')
    expect(value(acceptLowestBid(t, family, DAD, 22, [YOUNGER]))).toMatchObject({
      status: 'reserved',
      takerId: YOUNGER,
    })
  })

  it('a giver accepting the lowest at 25 after a re-bid to 23 is refused', () => {
    const t = bid(bid(carWash(), OLDER, 25), OLDER, 23)
    expect(error(acceptLowestBid(t, family, DAD, 25, [OLDER]))).toBe('offer_changed')
    expect(value(acceptLowestBid(t, family, DAD, 23, [OLDER]))).toMatchObject({ score: 23 })
  })
})

describe('the race between the two paths (spec §5.2): first to finish wins', () => {
  it('approval first: the task opens, bids close, bidding is refused', () => {
    const t = bid(carWash(), OLDER, 25)
    const open = value(approveOneTimeOffer(t, family, YOUNGER))
    expect(open).toEqual({ status: 'open', score: 30 })
    expect(error(placeOneTimeBid(open, family, OLDER, 22))).toBe('not_proposed')
    expect(error(acceptLowestBid(open, family, DAD, 25, [OLDER]))).toBe('not_proposed')
    expect(error(acceptOneTimeOffer(open, family, OLDER, 30))).toBe('not_proposed')
    expect(error(counterOneTimeOffer(open, family, DAD, 26, []))).toBe('not_proposed')
  })

  it('bid first: the task is reserved, pending approvals and other bids are gone', () => {
    const t = bid(bid(carWash(withMum), OLDER, 25, withMum), YOUNGER, 27, withMum)
    const reserved = value(
      acceptLowestBid(value(approveOneTimeOffer(t, withMum, MUM)), withMum, DAD, 25, [OLDER]),
    )
    expect(reserved).toEqual({ status: 'reserved', score: 25, takerId: OLDER, giverId: DAD })
    expect(error(approveOneTimeOffer(reserved, withMum, YOUNGER))).toBe('not_proposed')
    expect(error(placeOneTimeBid(reserved, withMum, YOUNGER, 20))).toBe('not_proposed')
  })

  it('a brother approving the plain offer while others bid opens it for everyone', () => {
    const t = bid(carWash(), OLDER, 20)
    expect(value(approveOneTimeOffer(t, family, OLDER))).toEqual({ status: 'open', score: 30 })
  })
})

describe('people change while bidding (spec §3)', () => {
  it("resolving drops a deactivated brother's bid", () => {
    const t = bid(bid(carWash(), OLDER, 20), YOUNGER, 25)
    const after = proposed(resolveOneTime(t, deactivate(family, OLDER)))
    expect(after.book).toEqual({ bids: [{ by: YOUNGER, score: 25 }] })
  })

  it('resolving with nothing changed returns the same task', () => {
    const t = bid(carWash(), OLDER, 20)
    expect(resolveOneTime(t, family)).toBe(t)
  })
})

describe('bid book helpers', () => {
  it('lowestBid lists every bidder at the lowest score, sorted', () => {
    const book = placeBid(placeBid(placeBid(EMPTY_BOOK, 3, 10), 2, 10), 5, 12)
    expect(lowestBid(book)).toEqual({ score: 10, bidders: [2, 3] })
    expect(lowestBid(EMPTY_BOOK)).toBeNull()
  })

  it('pruneBook returns the same book when nothing is dropped', () => {
    const book = placeBid(EMPTY_BOOK, 2, 10)
    expect(pruneBook(book, () => true)).toBe(book)
  })
})
