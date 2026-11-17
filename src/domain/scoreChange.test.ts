import { describe, expect, it } from 'vitest'
import type { AgreementError, ScoreProposal, TemplateAgreement } from './agreement'
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
  completeItem,
  createInstance,
  createOneTimeItem,
  markAgreed,
  reserveItem,
} from './lifecycle'
import type { Person } from './parties'
import type { Result } from './result'
import {
  acceptLowestTemplateBid,
  acceptTemplateBid,
  approveOneTimeScoreChange,
  bidTemplateScore,
  isOneTimeChangeAgreed,
  proposeOneTimeScoreChange,
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

describe('template score change runs like bidding (spec §5.1)', () => {
  it('any party starts a change by bidding; the old score stays in force', () => {
    const t = tbid(dishwasher(), OLDER, 8)
    expect(t).toEqual({
      status: 'agreed',
      score: 5,
      change: { bids: [{ by: OLDER, score: 8 }], counters: [] },
    })
    expect(value(scoreForNewInstance(t))).toBe(5)
    expect(canCreateInstances(t)).toBe(true)
  })

  it('each party one open bid, re-bid replaces it; givers bid too', () => {
    let t = tbid(dishwasher(), OLDER, 8)
    t = tbid(t, YOUNGER, 9)
    t = tbid(t, OLDER, 7)
    t = tbid(t, DAD, 6)
    expect(bids(t)).toEqual([
      { by: YOUNGER, score: 9 },
      { by: OLDER, score: 7 },
      { by: DAD, score: 6 },
    ])
  })

  it('a giver accepts the lowest open bid: new score for new instances only', () => {
    const t = tbid(tbid(dishwasher(), OLDER, 8), YOUNGER, 7)
    const before = value(scoreForNewInstance(t)) // an instance created now stores 5 and keeps it
    const agreed = value(acceptLowestTemplateBid(t, family, DAD))
    expect(agreed).toEqual({ status: 'agreed', score: 7, change: null })
    expect(before).toBe(5)
    expect(value(scoreForNewInstance(agreed))).toBe(7)
  })

  it('nobody is reserved anything; a tie just sets the score', () => {
    const t = tbid(tbid(dishwasher(), OLDER, 7), YOUNGER, 7)
    expect(value(acceptLowestTemplateBid(t, family, DAD))).toEqual({
      status: 'agreed',
      score: 7,
      change: null,
    })
  })

  it("a giver's own lowest bid needs a taker: giver accepting it is refused, a taker may accept", () => {
    const t = tbid(tbid(dishwasher(), OLDER, 8), DAD, 4)
    expect(error(acceptLowestTemplateBid(t, family, DAD))).toBe('needs_taker')
    expect(value(acceptTemplateBid(t, family, YOUNGER, DAD))).toEqual({
      status: 'agreed',
      score: 4,
      change: null,
    })
  })

  it('a tie between a giver and a taker at the lowest is agreed by the giver side', () => {
    const t = tbid(tbid(dishwasher(), OLDER, 4), DAD, 4)
    expect(value(acceptLowestTemplateBid(t, family, DAD))).toMatchObject({ score: 4 })
  })

  it('Mum may accept the lowest bid', () => {
    const t = tbid(dishwasher(withMum), YOUNGER, 6, withMum)
    expect(value(acceptLowestTemplateBid(t, withMum, MUM))).toMatchObject({ score: 6 })
  })

  it('refusals: not agreed, no change, wrong actors, same or bad scores', () => {
    const proposed = value(proposeTemplate(family, DAD, 5))
    expect(error(bidTemplateScore(proposed, family, OLDER, 8))).toBe('not_agreed')
    expect(error(acceptLowestTemplateBid(proposed, family, DAD))).toBe('not_agreed')
    expect(error(acceptTemplateBid(proposed, family, OLDER, DAD))).toBe('not_agreed')
    expect(error(acceptLowestTemplateBid(dishwasher(), family, DAD))).toBe('no_bids')
    expect(error(acceptTemplateBid(dishwasher(), family, OLDER, DAD))).toBe('no_bids')
    expect(error(bidTemplateScore(dishwasher(), family, JAKUB, 8))).toBe('not_a_party')
    expect(error(bidTemplateScore(dishwasher(), family, OLDER, 5))).toBe('same_score')
    expect(error(bidTemplateScore(tbid(dishwasher(), OLDER, 8), family, OLDER, 8))).toBe(
      'same_score',
    )
    for (const score of [0, 1.5, -2]) {
      expect(error(bidTemplateScore(dishwasher(), family, OLDER, score))).toBe('invalid_score')
    }
    const t = tbid(dishwasher(), OLDER, 8)
    expect(error(acceptLowestTemplateBid(t, family, OLDER))).toBe('not_a_giver')
    expect(error(acceptLowestTemplateBid(t, family, JAKUB))).toBe('not_a_giver')
    expect(error(acceptTemplateBid(t, family, DAD, OLDER))).toBe('not_a_taker')
    expect(error(acceptTemplateBid(t, family, YOUNGER, OLDER))).toBe('no_bid')
  })

  it("people change: a deactivated party's bid drops out", () => {
    const t = tbid(tbid(dishwasher(), OLDER, 6), YOUNGER, 8)
    const noOlder = deactivate(family, OLDER)
    expect(value(acceptLowestTemplateBid(t, noOlder, DAD))).toMatchObject({ score: 8 })
    expect(bids(resolveTemplate(t, noOlder))).toEqual([{ by: YOUNGER, score: 8 }])
    expect(resolveTemplate(t, family)).toBe(t)
    const dadBid = tbid(dishwasher(withMum), DAD, 4, withMum)
    expect(error(acceptTemplateBid(dadBid, deactivate(withMum, DAD), OLDER, DAD))).toBe('no_bid')
  })
})

// ── One-time tasks (spec §5.2) ───────────────────────────────────────────────────────────

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
    expect(value(approve(item, change, DAD)).agreed).toBe(true)
  })

  it('a giver proposes; the other taker cannot approve, the reserving one can', () => {
    const item = reservedTo(OLDER)
    const change = value(propose(item, DAD, 15))
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
    expect(error(propose(instance, DAD, 25))).toBe('wrong_state')
  })

  it('one change at a time, and only to a new score', () => {
    const pending = value(propose(open(), DAD, 25))
    expect(error(proposeOneTimeScoreChange(open(), SCORE, pending, family, OLDER, 30))).toBe(
      'change_pending',
    )
    expect(error(propose(open(), DAD, SCORE))).toBe('same_score')
    expect(error(propose(open(), DAD, 0))).toBe('invalid_score')
  })

  it('a proposer approving again is refused', () => {
    const change = value(propose(open(), DAD, 25))
    expect(error(approve(open(), change, DAD))).toBe('already_approved')
  })
})
