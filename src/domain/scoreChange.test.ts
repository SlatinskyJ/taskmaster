import { describe, expect, it } from 'vitest'
import type { AgreementError, ScoreProposal, TemplateAgreement, TemplateChange } from './agreement'
import {
  approveTemplate,
  canCreateInstances,
  proposeTemplate,
  resolveTemplate,
  scoreForNewInstance,
} from './agreement'
import type { Item } from './lifecycle'
import {
  approveCompletion,
  byPerson,
  cancelItem,
  completeItem,
  createInstance,
  createOneTimeItem,
  markAgreed,
  releaseReservation,
  reserveItem,
} from './lifecycle'
import type { Person } from './parties'
import type { Result } from './result'
import {
  acceptLowestTemplateBid,
  acceptTemplateOffer,
  approveOneTimeScoreChange,
  oneTimeChangeGiver,
  bidTemplateScore,
  counterTemplateScore,
  declineOneTimeScoreChange,
  oneTimeChangeWaitingFor,
  isOneTimeChangeAgreed,
  proposeOneTimeScoreChange,
  resolveOneTimeChange,
  turnDownTemplateChangeBids,
  withdrawTemplateChangeBid,
} from './scoreChange'

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
const person = (id: number) => {
  const p = withMum.find((x) => x.id === id)
  if (!p) throw new Error('no such person')
  return byPerson(p)
}
const T0 = new Date('2026-11-17T10:00:00.000Z')

function value<T, E extends string>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}
function error<T>(result: Result<T, AgreementError>): AgreementError {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

// ── Templates (spec §5.1) ────────────────────────────────────────────────────────────────

// Vyndat myčku: agreed at 5.
const dishwasher = (people: Person[] = family): TemplateAgreement =>
  value(approveTemplate(value(proposeTemplate(people, DAD, 5)), people, OLDER))
const tbid = (t: TemplateAgreement, who: number, score: number, people: Person[] = family) =>
  value(bidTemplateScore(t, people, who, score))
const bids = (t: TemplateAgreement) => (t.status === 'agreed' ? t.change?.bids : undefined)

const tcounter = (t: TemplateAgreement, who: number, score: number, people: Person[] = family) =>
  value(counterTemplateScore(t, people, who, score))

describe('template score change runs like bidding (spec §5.1)', () => {
  it('a taker starts a change by bidding; the old score stays in force', () => {
    const t = tbid(dishwasher(), OLDER, 8)
    expect(t).toEqual({
      status: 'agreed',
      score: 5,
      change: { bids: [{ by: OLDER, score: 8 }], offer: null },
    })
    expect(value(scoreForNewInstance(t))).toBe(5)
    expect(canCreateInstances(t)).toBe(true)
  })

  it('each taker one open bid, re-bid replaces it; givers do not bid', () => {
    let t = tbid(dishwasher(), OLDER, 8)
    t = tbid(t, YOUNGER, 9)
    t = tbid(t, OLDER, 7)
    expect(bids(t)).toEqual([
      { by: YOUNGER, score: 9 },
      { by: OLDER, score: 7 },
    ])
    expect(error(bidTemplateScore(t, family, DAD, 6))).toBe('not_a_taker')
  })

  it('a giver accepts the lowest taker bid: new score for new instances only', () => {
    const t = tbid(tbid(dishwasher(), OLDER, 8), YOUNGER, 7)
    const before = value(scoreForNewInstance(t)) // an instance created now stores 5 and keeps it
    const agreed = value(acceptLowestTemplateBid(t, family, DAD, 7))
    expect(agreed).toEqual({ status: 'agreed', score: 7, change: null })
    expect(before).toBe(5)
    expect(value(scoreForNewInstance(agreed))).toBe(7)
  })

  it('nobody is reserved anything; a tie just sets the score', () => {
    const t = tbid(tbid(dishwasher(), OLDER, 7), YOUNGER, 7)
    expect(value(acceptLowestTemplateBid(t, family, DAD, 7))).toEqual({
      status: 'agreed',
      score: 7,
      change: null,
    })
  })

  it('the giver counters the lowest bid with one offer to both; either taker accepts it', () => {
    const t = tcounter(tbid(tbid(dishwasher(), OLDER, 9), YOUNGER, 8), DAD, 7)
    expect(t).toEqual({
      status: 'agreed',
      score: 5,
      change: {
        bids: [
          { by: OLDER, score: 9 },
          { by: YOUNGER, score: 8 },
        ],
        offer: { score: 7, proposedBy: DAD },
      },
    })
    for (const who of [OLDER, YOUNGER]) {
      expect(value(acceptTemplateOffer(t, family, who, 7))).toEqual({
        status: 'agreed',
        score: 7,
        change: null,
      })
    }
  })

  it('a giver may start a change with an offer; a new counter replaces it', () => {
    const t = tcounter(tcounter(dishwasher(withMum), DAD, 4, withMum), MUM, 3, withMum)
    expect(t).toMatchObject({ change: { bids: [], offer: { score: 3, proposedBy: MUM } } })
    expect(error(bidTemplateScore(t, withMum, OLDER, 3))).toBe('same_score')
  })

  it("a taker's bid keeps the giver's offer; it can still be accepted", () => {
    const t = tbid(tcounter(dishwasher(), DAD, 6), OLDER, 8)
    expect(t).toMatchObject({
      change: { bids: [{ by: OLDER, score: 8 }], offer: { score: 6, proposedBy: DAD } },
    })
    expect(value(acceptTemplateOffer(t, family, YOUNGER, 6))).toMatchObject({ score: 6 })
  })

  it('an accept pins the number seen: a changed offer or lowest bid is refused', () => {
    const t = tcounter(
      tcounter(tbid(dishwasher(withMum), OLDER, 8, withMum), DAD, 4, withMum),
      MUM,
      2,
      withMum,
    )
    expect(error(acceptTemplateOffer(t, withMum, OLDER, 4))).toBe('offer_changed')
    expect(value(acceptTemplateOffer(t, withMum, OLDER, 2))).toMatchObject({ score: 2 })
    const rebid = tbid(t, OLDER, 9, withMum)
    expect(error(acceptLowestTemplateBid(rebid, withMum, DAD, 8))).toBe('offer_changed')
    expect(value(acceptLowestTemplateBid(rebid, withMum, DAD, 9))).toMatchObject({ score: 9 })
  })

  it('nothing is agreed until someone accepts: bids and offers leave the score in force', () => {
    const t = tcounter(tbid(dishwasher(), OLDER, 7), DAD, 6)
    expect(value(scoreForNewInstance(t))).toBe(5)
    expect(resolveTemplate(t, family)).toBe(t)
  })

  it('a giver countering at exactly the lowest open bid accepts it (spec §5.1, §5.2)', () => {
    const t = tbid(dishwasher(), OLDER, 4)
    expect(value(counterTemplateScore(t, family, DAD, 4))).toEqual({
      status: 'agreed',
      score: 4,
      change: null,
    })
  })

  it('a counter at a tie at the lowest accepts', () => {
    const t = tbid(tbid(dishwasher(), OLDER, 4), YOUNGER, 4)
    expect(value(counterTemplateScore(t, family, DAD, 4))).toEqual({
      status: 'agreed',
      score: 4,
      change: null,
    })
  })

  it('a counter at a higher bid is only a new offer', () => {
    const t = tcounter(tbid(tbid(dishwasher(), OLDER, 4), YOUNGER, 6), DAD, 6)
    expect(t).toEqual({
      status: 'agreed',
      score: 5,
      change: {
        bids: [
          { by: OLDER, score: 4 },
          { by: YOUNGER, score: 6 },
        ],
        offer: { score: 6, proposedBy: DAD },
      },
    })
    expect(value(acceptTemplateOffer(t, family, YOUNGER, 6))).toEqual({
      status: 'agreed',
      score: 6,
      change: null,
    })
  })

  it("a counter at a deactivated taker's bid is only a new offer", () => {
    const t = tbid(dishwasher(), OLDER, 4)
    const noOlder = deactivate(family, OLDER)
    const countered = value(counterTemplateScore(t, noOlder, DAD, 4))
    expect(countered).toMatchObject({ status: 'agreed', score: 5 })
    expect(countered.status === 'agreed' && countered.change?.offer?.score).toBe(4)
  })

  it('a new bid drops bids of people who left', () => {
    const t = tbid(dishwasher(), OLDER, 8)
    const noOlder = deactivate(family, OLDER)
    expect(bids(tbid(t, YOUNGER, 9, noOlder))).toEqual([{ by: YOUNGER, score: 9 }])
  })

  it('Mum may accept the lowest bid', () => {
    const t = tbid(dishwasher(withMum), YOUNGER, 6, withMum)
    expect(value(acceptLowestTemplateBid(t, withMum, MUM, 6))).toMatchObject({ score: 6 })
  })

  it('refusals: not agreed, nothing to accept, wrong actors, same or bad scores', () => {
    const proposed = value(proposeTemplate(family, DAD, 5))
    expect(error(bidTemplateScore(proposed, family, OLDER, 8))).toBe('not_agreed')
    expect(error(counterTemplateScore(proposed, family, DAD, 8))).toBe('not_agreed')
    expect(error(acceptLowestTemplateBid(proposed, family, DAD, 5))).toBe('not_agreed')
    expect(error(acceptTemplateOffer(proposed, family, OLDER, 5))).toBe('not_agreed')
    expect(error(acceptLowestTemplateBid(dishwasher(), family, DAD, 5))).toBe('no_bids')
    expect(error(acceptLowestTemplateBid(tcounter(dishwasher(), DAD, 4), family, DAD, 4))).toBe(
      'no_bids',
    )
    expect(error(acceptTemplateOffer(dishwasher(), family, OLDER, 5))).toBe('no_offer')
    expect(error(acceptTemplateOffer(tbid(dishwasher(), OLDER, 8), family, OLDER, 8))).toBe(
      'no_offer',
    )
    expect(error(bidTemplateScore(dishwasher(), family, JAKUB, 8))).toBe('not_a_taker')
    expect(error(bidTemplateScore(dishwasher(), family, OLDER, 5))).toBe('same_score')
    expect(error(bidTemplateScore(tbid(dishwasher(), OLDER, 8), family, OLDER, 8))).toBe(
      'same_score',
    )
    for (const score of [0, 1.5, -2]) {
      expect(error(bidTemplateScore(dishwasher(), family, OLDER, score))).toBe('invalid_score')
      expect(error(counterTemplateScore(dishwasher(), family, DAD, score))).toBe('invalid_score')
    }
    expect(error(counterTemplateScore(dishwasher(), family, DAD, 5))).toBe('same_score')
    expect(error(counterTemplateScore(tcounter(dishwasher(), DAD, 4), family, DAD, 4))).toBe(
      'same_score',
    )
    const t = tcounter(tbid(dishwasher(), OLDER, 8), DAD, 6)
    for (const who of [OLDER, JAKUB]) {
      expect(error(acceptLowestTemplateBid(t, family, who, 8))).toBe('not_a_giver')
      expect(error(counterTemplateScore(t, family, who, 7))).toBe('not_a_giver')
    }
    for (const who of [DAD, JAKUB]) {
      expect(error(acceptTemplateOffer(t, family, who, 6))).toBe('not_a_taker')
    }
  })

  it("people change: a deactivated taker's bid drops out", () => {
    const t = tbid(tbid(dishwasher(), OLDER, 6), YOUNGER, 8)
    const noOlder = deactivate(family, OLDER)
    expect(value(acceptLowestTemplateBid(t, noOlder, DAD, 8))).toMatchObject({ score: 8 })
    expect(bids(resolveTemplate(t, noOlder))).toEqual([{ by: YOUNGER, score: 8 }])
    expect(resolveTemplate(t, family)).toBe(t)
  })
})

// ── One-time tasks (spec §5.2) ───────────────────────────────────────────────────────────

describe('template change: same number, Nechci, turn-down (#232)', () => {
  const agreed = (
    change: TemplateChange | null,
    lastBids: { by: number; score: number }[] = [],
  ): TemplateAgreement => ({ status: 'agreed', score: 10, change, lastBids })

  it('bid refuses his last bid since the floor, open or withdrawn', () => {
    const t = agreed(null, [{ by: OLDER, score: 12 }])
    expect(error(bidTemplateScore(t, family, OLDER, 12))).toBe('same_score')
    expect(bids(tbid(t, YOUNGER, 12))).toEqual([{ by: YOUNGER, score: 12 }])
    expect(bids(tbid(t, OLDER, 13))).toEqual([{ by: OLDER, score: 13 }])
  })

  it('Nechci closes only his bid; the offer stays', () => {
    const t = agreed({
      offer: { score: 14, proposedBy: DAD },
      bids: [
        { by: OLDER, score: 12 },
        { by: YOUNGER, score: 13 },
      ],
    })
    expect(value(withdrawTemplateChangeBid(t, family, OLDER))).toMatchObject({
      status: 'agreed',
      score: 10,
      change: { offer: { score: 14, proposedBy: DAD }, bids: [{ by: YOUNGER, score: 13 }] },
    })
    const after = value(withdrawTemplateChangeBid(t, family, OLDER))
    expect(error(withdrawTemplateChangeBid(after, family, OLDER))).toBe('no_bid')
    expect(error(withdrawTemplateChangeBid(agreed(null), family, OLDER))).toBe('no_bid')
    expect(error(withdrawTemplateChangeBid(t, family, DAD))).toBe('not_a_taker')
    const proposed = value(proposeTemplate(family, DAD, 5))
    expect(error(withdrawTemplateChangeBid(proposed, family, OLDER))).toBe('not_agreed')
  })

  it('Nechci of the last row ends the change', () => {
    const t = agreed({ offer: null, bids: [{ by: OLDER, score: 12 }] })
    expect(value(withdrawTemplateChangeBid(t, family, OLDER))).toMatchObject({ change: null })
  })

  it('Nechci of the last bid keeps a standing offer in flight', () => {
    const offer = { score: 14, proposedBy: DAD }
    const t = agreed({ offer, bids: [{ by: OLDER, score: 12 }] })
    expect(value(withdrawTemplateChangeBid(t, family, OLDER))).toMatchObject({
      change: { offer, bids: [] },
    })
  })

  const two = [
    { by: OLDER, score: 12 },
    { by: YOUNGER, score: 13 },
  ]

  it('turn-down keeps the parent offer, now by the giver who turned down; every bid closes', () => {
    const t = agreed({ offer: { score: 14, proposedBy: DAD }, bids: two })
    expect(value(turnDownTemplateChangeBids(t, withMum, MUM, two))).toMatchObject({
      status: 'agreed',
      score: 10,
      change: { offer: { score: 14, proposedBy: MUM }, bids: [] },
    })
  })

  it('turn-down with no offer ends the change; the score stays', () => {
    const t = agreed({ offer: null, bids: two })
    expect(value(turnDownTemplateChangeBids(t, family, DAD, two))).toMatchObject({
      status: 'agreed',
      score: 10,
      change: null,
    })
  })

  it('turn-down refuses a stale list, a taker, no bids', () => {
    const t = agreed({ offer: null, bids: two })
    const stale = [
      [{ by: OLDER, score: 12 }],
      [...two, { by: JAKUB, score: 9 }],
      [
        { by: OLDER, score: 11 },
        { by: YOUNGER, score: 13 },
      ],
    ]
    for (const seen of stale) {
      expect(error(turnDownTemplateChangeBids(t, family, DAD, seen))).toBe('offer_changed')
    }
    expect(error(turnDownTemplateChangeBids(t, family, OLDER, two))).toBe('not_a_giver')
    const offerOnly = agreed({ offer: { score: 14, proposedBy: DAD }, bids: [] })
    expect(error(turnDownTemplateChangeBids(offerOnly, family, DAD, []))).toBe('no_bids')
    expect(error(turnDownTemplateChangeBids(agreed(null), family, DAD, []))).toBe('no_bids')
    const proposed = value(proposeTemplate(family, DAD, 5))
    expect(error(turnDownTemplateChangeBids(proposed, family, DAD, []))).toBe('not_agreed')
  })
})

const negotiating = (): Item => value(createOneTimeItem(person(DAD)))
const open = (): Item => value(markAgreed(negotiating(), null))
const reservedTo = (taker: number): Item => value(reserveItem(open(), person(taker), T0))
const SCORE = 20

const propose = (item: Item, who: number, score: number, people: Person[] = family) =>
  proposeOneTimeScoreChange(item, SCORE, null, people, who, score)
const approve = (item: Item, change: ScoreProposal, who: number, people: Person[] = family) =>
  approveOneTimeScoreChange(item, change, people, who)

describe('changing an open one-time task (spec §5.2): any party, a giver + a taker', () => {
  it('a taker proposes, a giver approves: agreed', () => {
    const change = value(propose(open(), YOUNGER, 25))
    expect(isOneTimeChangeAgreed(open(), change, family)).toBe(false)
    const r = value(approve(open(), change, DAD))
    expect(r.agreed).toBe(true)
    expect(r.change.score).toBe(25)
  })

  it('a giver proposes, any taker approves', () => {
    const change = value(propose(open(), DAD, 15))
    expect(value(approve(open(), change, OLDER)).agreed).toBe(true)
  })

  it('two takers without a giver are not enough', () => {
    const change = value(propose(open(), YOUNGER, 25))
    expect(value(approve(open(), change, OLDER)).agreed).toBe(false)
  })

  it('the admin cannot propose or approve', () => {
    expect(error(propose(open(), JAKUB, 25))).toBe('not_a_party')
    expect(error(approve(open(), value(propose(open(), DAD, 15)), JAKUB))).toBe('not_a_party')
  })
})

describe('changing a reserved one-time task (spec §5.2): that taker + a giver', () => {
  it('the reserving taker proposes, a giver approves: agreed', () => {
    const item = reservedTo(OLDER)
    const change = value(propose(item, OLDER, 25))
    expect(isOneTimeChangeAgreed(item, change, family)).toBe(false)
    expect(value(approve(item, change, DAD)).agreed).toBe(true)
  })

  it('a giver proposes; the other taker cannot approve, the reserving one can', () => {
    const item = reservedTo(OLDER)
    const change = value(propose(item, DAD, 15))
    expect(isOneTimeChangeAgreed(item, change, family)).toBe(false)
    expect(error(approve(item, change, YOUNGER))).toBe('not_involved')
    expect(value(approve(item, change, OLDER)).agreed).toBe(true)
  })

  it('the other taker cannot propose', () => {
    expect(error(propose(reservedTo(OLDER), YOUNGER, 25))).toBe('not_involved')
  })

  it('reserved by bid works the same', () => {
    const item = value(markAgreed(negotiating(), { takerId: OLDER, giverId: DAD }))
    const change = value(propose(item, OLDER, 25))
    expect(value(approve(item, change, DAD)).agreed).toBe(true)
  })

  it('a change proposed while open needs the reserving taker once someone reserves', () => {
    const change = value(propose(open(), DAD, 15))
    const item = reservedTo(OLDER)
    const afterYounger = { ...change, approvedBy: [...change.approvedBy, YOUNGER] }
    expect(isOneTimeChangeAgreed(item, afterYounger, family)).toBe(false)
    expect(value(approve(item, change, OLDER)).agreed).toBe(true)
  })

  it('a deactivated reserving taker cannot agree', () => {
    const item = reservedTo(OLDER)
    const change = value(propose(item, DAD, 15))
    const both = { ...change, approvedBy: [DAD, OLDER] }
    expect(isOneTimeChangeAgreed(item, both, deactivate(family, OLDER))).toBe(false)
  })
})

describe('when a one-time score cannot change (spec §5.2)', () => {
  it('once completed the score is frozen (pending or confirmed)', () => {
    const done = value(completeItem(open(), person(OLDER), T0))
    const confirmed = value(approveCompletion(done, person(DAD)))
    for (const item of [done, confirmed]) {
      expect(error(propose(item, DAD, 25))).toBe('score_frozen')
      expect(error(approve(item, value(propose(open(), DAD, 25)), OLDER))).toBe('score_frozen')
    }
  })

  it('still negotiating: use bidding instead', () => {
    expect(error(propose(negotiating(), DAD, 25))).toBe('not_agreed')
  })

  it('instances follow their template, not this rule', () => {
    const instance = value(createInstance(person(DAD), 'on_demand', true, null))
    expect(error(propose(instance, DAD, 25))).toBe('not_changeable')
  })

  it('one change at a time, and only to a new score', () => {
    const pending = value(propose(open(), DAD, 25))
    expect(error(proposeOneTimeScoreChange(open(), SCORE, pending, family, OLDER, 30))).toBe(
      'change_pending',
    )
    expect(error(propose(open(), DAD, SCORE))).toBe('same_score')
    expect(error(propose(open(), DAD, 0))).toBe('invalid_score')
  })

  it('a pending change is dropped once the task leaves open/reserved, so a new one can start', () => {
    const item = value(markAgreed(negotiating(), { takerId: OLDER, giverId: DAD }))
    const change = value(propose(item, OLDER, 25))
    const released = value(releaseReservation(item, person(OLDER)))
    expect(resolveOneTimeChange(released, change, family)).toBeNull()
    const done = value(completeItem(open(), person(OLDER), T0))
    expect(resolveOneTimeChange(done, change, family)).toBeNull()
    const again = value(markAgreed(released, null))
    expect(value(proposeOneTimeScoreChange(again, SCORE, null, family, DAD, 18)).score).toBe(18)
  })

  it('resolving a still valid change drops approvals of people who left', () => {
    const change = value(propose(open(), YOUNGER, 25))
    expect(resolveOneTimeChange(open(), change, family)).toEqual(change)
    expect(resolveOneTimeChange(open(), change, deactivate(family, YOUNGER))?.approvedBy).toEqual(
      [],
    )
  })

  it('a proposer approving again is refused', () => {
    const change = value(propose(open(), DAD, 25))
    expect(error(approve(open(), change, DAD))).toBe('already_approved')
  })
})

const decline = (item: Item, change: ScoreProposal, who: number, people: Person[] = family) =>
  declineOneTimeScoreChange(item, change, people, who)
const waiting = (item: Item, change: ScoreProposal, people: Person[] = family) =>
  oneTimeChangeWaitingFor(item, change, people)

describe('saying no to a one-time change (Jakub 2026-11-21: only who it waits for)', () => {
  it('the proposer withdraws; a taker it waits for declines; the admin cannot', () => {
    const change = value(propose(open(), DAD, 25))
    expect(value(decline(open(), change, DAD))).toBe('withdrawn')
    expect(value(decline(open(), change, OLDER))).toBe('declined')
    expect(error(decline(open(), change, JAKUB))).toBe('not_a_party')
  })

  it('open, a taker proposed: the other taker is not involved, the giver declines', () => {
    const change = value(propose(open(), OLDER, 15))
    expect(error(decline(open(), change, YOUNGER))).toBe('not_involved')
    expect(value(decline(open(), change, DAD))).toBe('declined')
  })

  it('reserved, a giver proposed: only the reserving taker declines', () => {
    const item = reservedTo(OLDER)
    const change = value(propose(item, DAD, 15))
    expect(error(decline(item, change, YOUNGER))).toBe('not_involved')
    expect(value(decline(item, change, OLDER))).toBe('declined')
  })

  it('someone who already approved (not the proposer) cannot say no', () => {
    const change = value(propose(open(), DAD, 25, withMum))
    const approved = value(approve(open(), change, MUM, withMum)).change
    expect(error(decline(open(), approved, MUM, withMum))).toBe('not_involved')
  })

  it('a frozen, negotiating or cancelled task refuses', () => {
    const change = value(propose(open(), DAD, 25))
    const done = value(completeItem(open(), person(OLDER), T0))
    expect(error(decline(done, change, OLDER))).toBe('score_frozen')
    expect(error(decline(negotiating(), change, OLDER))).toBe('not_agreed')
    const cancelled = value(cancelItem(open(), person(DAD)))
    expect(error(decline(cancelled, change, OLDER))).toBe('not_changeable')
  })
})

describe('who a one-time change waits for', () => {
  it('open: the side that has not said yes', () => {
    expect(waiting(open(), value(propose(open(), DAD, 25)))).toEqual([OLDER, YOUNGER])
    expect(waiting(open(), value(propose(open(), OLDER, 15)))).toEqual([DAD])
    expect(waiting(open(), value(propose(open(), OLDER, 15, withMum)), withMum)).toEqual([DAD, MUM])
  })

  it('reserved: the reserving taker, or the givers', () => {
    const item = reservedTo(OLDER)
    expect(waiting(item, value(propose(item, DAD, 15)))).toEqual([OLDER])
    expect(waiting(item, value(propose(item, OLDER, 25)))).toEqual([DAD])
  })

  it('nobody once agreed or frozen', () => {
    const change = value(propose(open(), DAD, 25))
    expect(waiting(open(), value(approve(open(), change, OLDER)).change)).toEqual([])
    const confirmed = value(
      approveCompletion(value(completeItem(open(), person(OLDER), T0)), person(DAD)),
    )
    expect(waiting(confirmed, change)).toEqual([])
  })
})

describe('oneTimeChangeGiver: whose offer a bid-won task holds at the new score', () => {
  const change = (approvedBy: number[]): ScoreProposal => ({
    proposedBy: approvedBy[0] ?? OLDER,
    score: 20,
    approvedBy,
  })
  it('the first active giver who said yes, else null', () => {
    expect(oneTimeChangeGiver(change([OLDER, MUM, DAD]), withMum)).toBe(MUM)
    expect(oneTimeChangeGiver(change([DAD, OLDER]), withMum)).toBe(DAD)
    expect(oneTimeChangeGiver(change([OLDER, DAD, MUM]), deactivate(withMum, DAD))).toBe(MUM)
    expect(oneTimeChangeGiver(change([OLDER, YOUNGER]), withMum)).toBeNull()
  })
})
