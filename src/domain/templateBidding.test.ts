import { describe, expect, it } from 'vitest'
import type { AgreementError, TemplateAgreement } from './agreement'
import { proposeTemplate } from './agreement'
import type { Person } from './parties'
import type { Result } from './result'
import {
  acceptLowestProposedTemplateBid,
  acceptProposedTemplateOffer,
  counterProposedTemplate,
  placeProposedTemplateBid,
  turnDownProposedTemplateBids,
  withdrawProposedTemplateBid,
} from './templateBidding'

// Bidding on a proposed chore's first score (#209, spec §5.1): the one-time rules, no reservation.
const ADMIN = 1
const TATA = 2
const STARSI = 3
const MLADSI = 4

const family: Person[] = [
  { id: ADMIN, role: 'admin', active: true },
  { id: TATA, role: 'giver', active: true },
  { id: STARSI, role: 'taker', active: true },
  { id: MLADSI, role: 'taker', active: true },
]

function value<T>(result: Result<T, AgreementError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}
function error<T>(result: Result<T, AgreementError>): AgreementError {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

/** Vynést koš, proposed by Táta at 10. */
const chore = (): TemplateAgreement => value(proposeTemplate(family, TATA, 10))
const bid = (t: TemplateAgreement, who: number, score: number) =>
  value(placeProposedTemplateBid(t, family, who, score))
const proposed = (t: TemplateAgreement) => {
  if (t.status !== 'proposed') throw new Error('expected proposed')
  return t
}
const agreed: TemplateAgreement = { status: 'agreed', score: 10, change: null }

describe('bidding on a proposed chore (#209)', () => {
  it('a bid adds to the book; the offer and his last bid are refused', () => {
    const t = proposed(bid(chore(), STARSI, 12))
    expect(t.book.bids).toEqual([{ by: STARSI, score: 12 }])
    expect(t.proposal.score).toBe(10)
    expect(error(placeProposedTemplateBid(t, family, MLADSI, 10))).toBe('same_score')
    expect(error(placeProposedTemplateBid(t, family, STARSI, 12))).toBe('same_score')
  })

  it('Nechci closes only his bid and still blocks the same number', () => {
    const both = bid(bid(chore(), STARSI, 12), MLADSI, 14)
    const t = proposed(value(withdrawProposedTemplateBid(both, family, STARSI)))
    expect(t.book.bids).toEqual([{ by: MLADSI, score: 14 }])
    expect(error(placeProposedTemplateBid(t, family, STARSI, 12))).toBe('same_score')
    expect(error(withdrawProposedTemplateBid(t, family, STARSI))).toBe('no_bid')
  })

  it('a turn-down closes every bid and frees the number', () => {
    const t = bid(chore(), STARSI, 12)
    const down = proposed(
      value(turnDownProposedTemplateBids(t, family, TATA, [{ by: STARSI, score: 12 }])),
    )
    expect(down.book.bids).toEqual([])
    expect(down.lastBids).toEqual([])
    expect(down.proposal).toEqual({ score: 10, proposedBy: TATA, approvedBy: [TATA] })
    expect(proposed(bid(down, STARSI, 12)).book.bids).toEqual([{ by: STARSI, score: 12 }])
  })

  it('a turn-down with other bids than seen is offer_changed', () => {
    const t = bid(bid(chore(), STARSI, 12), MLADSI, 14)
    expect(error(turnDownProposedTemplateBids(t, family, TATA, [{ by: STARSI, score: 12 }]))).toBe(
      'offer_changed',
    )
    expect(error(turnDownProposedTemplateBids(chore(), family, TATA, []))).toBe('no_bids')
  })

  it('a counter is a new offer and resets the same-number rule', () => {
    const t = proposed(value(counterProposedTemplate(bid(chore(), STARSI, 12), family, TATA, 11)))
    expect(t.proposal).toEqual({ score: 11, proposedBy: TATA, approvedBy: [TATA] })
    expect(t.lastBids).toEqual([])
    expect(t.book.bids).toEqual([{ by: STARSI, score: 12 }])
    expect(proposed(bid(t, STARSI, 13)).book.bids).toEqual([{ by: STARSI, score: 13 }])
    expect(error(counterProposedTemplate(t, family, TATA, 11))).toBe('same_score')
  })

  it('a counter at an open bid agrees at it, a tie too', () => {
    const one = bid(chore(), STARSI, 12)
    expect(value(counterProposedTemplate(one, family, TATA, 12))).toEqual({
      status: 'agreed',
      score: 12,
      change: null,
    })
    const tie = bid(one, MLADSI, 12)
    expect(value(counterProposedTemplate(tie, family, TATA, 12))).toEqual({
      status: 'agreed',
      score: 12,
      change: null,
    })
  })

  it('accept lowest agrees at the lowest; a moved lowest is offer_changed', () => {
    const t = bid(bid(chore(), STARSI, 14), MLADSI, 12)
    expect(value(acceptLowestProposedTemplateBid(t, family, TATA, 12))).toEqual({
      status: 'agreed',
      score: 12,
      change: null,
    })
    expect(error(acceptLowestProposedTemplateBid(t, family, TATA, 14))).toBe('offer_changed')
    expect(error(acceptLowestProposedTemplateBid(chore(), family, TATA, 10))).toBe('no_bids')
  })

  it("a bidder's yes to the offer agrees at it; without a bid it is no_bid", () => {
    const t = bid(chore(), STARSI, 12)
    expect(value(acceptProposedTemplateOffer(t, family, STARSI, 10))).toEqual({
      status: 'agreed',
      score: 10,
      change: null,
    })
    expect(error(acceptProposedTemplateOffer(t, family, STARSI, 11))).toBe('offer_changed')
    expect(error(acceptProposedTemplateOffer(t, family, MLADSI, 10))).toBe('no_bid')
  })

  it('every action on an agreed template is not_proposed', () => {
    const seen = [{ by: STARSI, score: 12 }]
    expect(error(placeProposedTemplateBid(agreed, family, STARSI, 12))).toBe('not_proposed')
    expect(error(withdrawProposedTemplateBid(agreed, family, STARSI))).toBe('not_proposed')
    expect(error(turnDownProposedTemplateBids(agreed, family, TATA, seen))).toBe('not_proposed')
    expect(error(counterProposedTemplate(agreed, family, TATA, 12))).toBe('not_proposed')
    expect(error(acceptProposedTemplateOffer(agreed, family, STARSI, 10))).toBe('not_proposed')
    expect(error(acceptLowestProposedTemplateBid(agreed, family, TATA, 12))).toBe('not_proposed')
  })

  it('a brother cannot counter, accept lowest or turn down; a parent cannot bid or withdraw', () => {
    const t = bid(chore(), STARSI, 12)
    const seen = [{ by: STARSI, score: 12 }]
    expect(error(counterProposedTemplate(t, family, MLADSI, 11))).toBe('not_a_giver')
    expect(error(acceptLowestProposedTemplateBid(t, family, MLADSI, 12))).toBe('not_a_giver')
    expect(error(turnDownProposedTemplateBids(t, family, MLADSI, seen))).toBe('not_a_giver')
    expect(error(placeProposedTemplateBid(t, family, TATA, 11))).toBe('not_a_taker')
    expect(error(withdrawProposedTemplateBid(t, family, TATA))).toBe('not_a_taker')
    expect(error(acceptProposedTemplateOffer(t, family, TATA, 10))).toBe('not_a_taker')
  })

  it('an admin can do none of them', () => {
    const t = bid(chore(), STARSI, 12)
    const seen = [{ by: STARSI, score: 12 }]
    expect(error(placeProposedTemplateBid(t, family, ADMIN, 11))).toBe('not_a_taker')
    expect(error(withdrawProposedTemplateBid(t, family, ADMIN))).toBe('not_a_taker')
    expect(error(acceptProposedTemplateOffer(t, family, ADMIN, 10))).toBe('not_a_taker')
    expect(error(counterProposedTemplate(t, family, ADMIN, 11))).toBe('not_a_giver')
    expect(error(acceptLowestProposedTemplateBid(t, family, ADMIN, 12))).toBe('not_a_giver')
    expect(error(turnDownProposedTemplateBids(t, family, ADMIN, seen))).toBe('not_a_giver')
  })

  it('score boundaries: 1 is a valid bid, 0 and 1.5 are invalid_score', () => {
    expect(proposed(bid(chore(), STARSI, 1)).book.bids).toEqual([{ by: STARSI, score: 1 }])
    expect(error(placeProposedTemplateBid(chore(), family, STARSI, 0))).toBe('invalid_score')
    expect(error(placeProposedTemplateBid(chore(), family, STARSI, 1.5))).toBe('invalid_score')
  })
})
