import { describe, expect, it } from 'vitest'
import type { AgreementError, OneTimeAgreement } from './agreement'
import { approveOneTimeOffer, createOneTimeTask, resolveOneTime } from './agreement'
import {
  acceptLowestBid,
  acceptOneTimeOffer,
  counterOneTimeBid,
  currentOfferTo,
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

describe('counters (spec §5.2) [call] any active giver', () => {
  it("a giver counters a brother's bid; that becomes the giver's offer to him", () => {
    const t = proposed(value(counterOneTimeBid(bid(carWash(), OLDER, 20), family, DAD, OLDER, 26)))
    expect(t.book.counters).toEqual([{ by: DAD, to: OLDER, score: 26 }])
    expect(currentOfferTo(t, family, OLDER)).toEqual({ score: 26, giverId: DAD })
    expect(currentOfferTo(t, family, YOUNGER)).toEqual({ score: 30, giverId: DAD })
  })

  it('Mum may counter too, replacing the earlier counter to that brother', () => {
    let t = bid(carWash(withMum), OLDER, 20, withMum)
    t = value(counterOneTimeBid(t, withMum, DAD, OLDER, 26))
    t = value(counterOneTimeBid(t, withMum, MUM, OLDER, 24))
    expect(proposed(t).book.counters).toEqual([{ by: MUM, to: OLDER, score: 24 }])
  })

  it('a brother may re-bid after a counter, but not the counter itself', () => {
    const t = value(counterOneTimeBid(bid(carWash(), OLDER, 20), family, DAD, OLDER, 26))
    const rebid = proposed(bid(t, OLDER, 23))
    expect(rebid.book.bids).toEqual([{ by: OLDER, score: 23 }])
    // Dad's counter is still his current offer to Older.
    expect(currentOfferTo(rebid, family, OLDER)).toEqual({ score: 26, giverId: DAD })
    expect(value(acceptOneTimeOffer(rebid, family, OLDER))).toEqual({
      status: 'reserved',
      score: 26,
      takerId: OLDER,
      giverId: DAD,
    })
    expect(error(placeOneTimeBid(t, family, OLDER, 26))).toBe('same_score')
  })

  it('needs an open bid from an active taker, a new score, and an active giver', () => {
    const t = bid(carWash(), OLDER, 20)
    expect(error(counterOneTimeBid(t, family, DAD, YOUNGER, 26))).toBe('no_bid')
    expect(error(counterOneTimeBid(t, family, DAD, OLDER, 20))).toBe('same_score')
    expect(error(counterOneTimeBid(t, family, OLDER, OLDER, 26))).toBe('not_a_giver')
    expect(error(counterOneTimeBid(t, family, JAKUB, OLDER, 26))).toBe('not_a_giver')
    expect(error(counterOneTimeBid(t, family, DAD, OLDER, 0))).toBe('invalid_score')
    expect(error(counterOneTimeBid(t, deactivate(family, OLDER), DAD, OLDER, 26))).toBe('no_bid')
    const countered = value(counterOneTimeBid(t, family, DAD, OLDER, 26))
    expect(error(counterOneTimeBid(countered, family, DAD, OLDER, 26))).toBe('same_score')
  })
})

describe('a brother accepts the offer (spec §5.2): agreed + reserved in one step', () => {
  it("accepts Dad's counter: reserved to him at the counter", () => {
    const t = value(counterOneTimeBid(bid(carWash(), OLDER, 20), family, DAD, OLDER, 26))
    expect(value(acceptOneTimeOffer(t, family, OLDER))).toEqual({
      status: 'reserved',
      score: 26,
      takerId: OLDER,
      giverId: DAD,
    })
  })

  it("with no counter, accepts the task's offer from the giver who made it", () => {
    const t = bid(carWash(withMum), OLDER, 20, withMum)
    expect(value(acceptOneTimeOffer(t, withMum, OLDER))).toEqual({
      status: 'reserved',
      score: 30,
      takerId: OLDER,
      giverId: DAD,
    })
  })

  it("Mum's counter: Mum is the agreeing giver", () => {
    const t = value(
      counterOneTimeBid(bid(carWash(withMum), OLDER, 20, withMum), withMum, MUM, OLDER, 25),
    )
    const r = value(acceptOneTimeOffer(t, withMum, OLDER))
    expect(r.status === 'reserved' && r.giverId).toBe(MUM)
  })

  it("a counter from a giver who has left no longer counts: the task's offer applies", () => {
    let t = bid(carWash(withMum), OLDER, 20, withMum)
    t = value(counterOneTimeBid(t, withMum, MUM, OLDER, 25))
    const noMum = deactivate(withMum, MUM)
    expect(currentOfferTo(proposed(t), noMum, OLDER)).toEqual({ score: 30, giverId: DAD })
    expect(value(acceptOneTimeOffer(t, noMum, OLDER))).toEqual({
      status: 'reserved',
      score: 30,
      takerId: OLDER,
      giverId: DAD,
    })
    // And he may now bid Mum's old counter.
    expect(proposed(bid(t, OLDER, 25, noMum)).book.bids).toEqual([{ by: OLDER, score: 25 }])
  })

  it('needs his own open bid; without one he approves the offer instead (path 1)', () => {
    expect(error(acceptOneTimeOffer(carWash(), family, OLDER))).toBe('no_bid')
    expect(error(acceptOneTimeOffer(bid(carWash(), OLDER, 20), family, YOUNGER))).toBe('no_bid')
  })

  it('only an active taker; the offering giver must still be active', () => {
    const t = bid(carWash(withMum), OLDER, 20, withMum)
    expect(error(acceptOneTimeOffer(t, withMum, DAD))).toBe('not_a_taker')
    expect(error(acceptOneTimeOffer(t, withMum, JAKUB))).toBe('not_a_taker')
    expect(error(acceptOneTimeOffer(t, deactivate(withMum, DAD), OLDER))).toBe('not_a_giver')
  })
})

describe('the giver side accepts the lowest open bid (spec §5.2)', () => {
  it('one lowest bidder: reserved to him at his bid', () => {
    const t = bid(bid(bid(carWash(), OLDER, 25), YOUNGER, 27), OLDER, 23)
    expect(value(acceptLowestBid(t, family, DAD))).toEqual({
      status: 'reserved',
      score: 23,
      takerId: OLDER,
      giverId: DAD,
    })
  })

  it('a tie at the lowest: open at that score, the brothers sort it out', () => {
    const t = bid(bid(carWash(), OLDER, 24), YOUNGER, 24)
    expect(value(acceptLowestBid(t, family, DAD))).toEqual({ status: 'open', score: 24 })
  })

  it('a bid above the offer is still a bid; the lowest wins', () => {
    const t = bid(carWash(), YOUNGER, 35)
    expect(value(acceptLowestBid(t, family, DAD))).toMatchObject({ score: 35, takerId: YOUNGER })
  })

  it('[call] Mum may accept', () => {
    const t = bid(carWash(withMum), YOUNGER, 22, withMum)
    expect(value(acceptLowestBid(t, withMum, MUM))).toMatchObject({
      takerId: YOUNGER,
      giverId: MUM,
    })
  })

  it('needs an active giver and at least one bid', () => {
    const t = bid(carWash(), OLDER, 25)
    for (const who of [OLDER, JAKUB])
      expect(error(acceptLowestBid(t, family, who))).toBe('not_a_giver')
    expect(error(acceptLowestBid(carWash(), family, DAD))).toBe('no_bids')
  })

  it("a deactivated brother's bid does not count", () => {
    const t = bid(bid(carWash(), OLDER, 20), YOUNGER, 25)
    const noOlder = deactivate(family, OLDER)
    expect(value(acceptLowestBid(t, noOlder, DAD))).toMatchObject({ score: 25, takerId: YOUNGER })
    const noBrothers = deactivate(noOlder, YOUNGER)
    expect(error(acceptLowestBid(t, noBrothers, DAD))).toBe('no_bids')
  })
})

describe('the race between the two paths (spec §5.2): first to finish wins', () => {
  it('approval first: the task opens, bids close, bidding is refused', () => {
    const t = bid(carWash(), OLDER, 25)
    const open = value(approveOneTimeOffer(t, family, YOUNGER))
    expect(open).toEqual({ status: 'open', score: 30 })
    expect(error(placeOneTimeBid(open, family, OLDER, 22))).toBe('not_proposed')
    expect(error(acceptLowestBid(open, family, DAD))).toBe('not_proposed')
    expect(error(acceptOneTimeOffer(open, family, OLDER))).toBe('not_proposed')
    expect(error(counterOneTimeBid(open, family, DAD, OLDER, 26))).toBe('not_proposed')
  })

  it('bid first: the task is reserved, pending approvals and other bids are gone', () => {
    const t = bid(bid(carWash(withMum), OLDER, 25, withMum), YOUNGER, 27, withMum)
    const reserved = value(
      acceptLowestBid(value(approveOneTimeOffer(t, withMum, MUM)), withMum, DAD),
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
  it("resolving drops a deactivated brother's bid and counters to him", () => {
    let t = bid(bid(carWash(), OLDER, 20), YOUNGER, 25)
    t = value(counterOneTimeBid(t, family, DAD, OLDER, 26))
    const after = proposed(resolveOneTime(t, deactivate(family, OLDER)))
    expect(after.book).toEqual({ bids: [{ by: YOUNGER, score: 25 }], counters: [] })
  })

  it("resolving drops a deactivated giver's counters", () => {
    let t = bid(carWash(withMum), OLDER, 20, withMum)
    t = value(counterOneTimeBid(t, withMum, MUM, OLDER, 26))
    const after = proposed(resolveOneTime(t, deactivate(withMum, MUM)))
    expect(after.book.counters).toEqual([])
    expect(after.book.bids).toEqual([{ by: OLDER, score: 20 }])
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
    expect(
      pruneBook(
        book,
        () => true,
        () => true,
      ),
    ).toBe(book)
  })
})
