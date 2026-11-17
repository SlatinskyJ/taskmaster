import { describe, expect, it } from 'vitest'
import type { OneTimeAgreement, ScoreProposal, TemplateAgreement } from './agreement'
import {
  approveOneTimeOffer,
  approveScore,
  approveTemplate,
  canCreateInstances,
  createOneTimeTask,
  reopenOneTimeOffer,
  isAgreed,
  isValidScore,
  missingRoles,
  proposeScore,
  proposeTemplate,
  scoreForNewInstance,
  resolveOneTime,
  resolveTemplate,
} from './agreement'
import type { Person } from './parties'
import { allParties, isParty } from './parties'
import type { Result } from './result'

// The family (spec §3): Dad gives, two brothers take, Jakub is admin. Mum may join later.
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
const withoutYounger: Person[] = family.map((p) => (p.id === YOUNGER ? { ...p, active: false } : p))
const withoutOlder: Person[] = family.map((p) => (p.id === OLDER ? { ...p, active: false } : p))
const olderNowAdmin: Person[] = family.map((p) => (p.id === OLDER ? { ...p, role: 'admin' } : p))

function value<T>(result: Result<T, string>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}

describe('parties (spec §3)', () => {
  it('parties = active givers + active takers; the admin never counts', () => {
    expect(allParties(family)).toEqual([DAD, OLDER, YOUNGER])
    expect(isParty({ id: JAKUB, role: 'admin', active: true })).toBe(false)
  })

  it('Mum becomes a party as soon as she is added', () => {
    expect(allParties(withMum)).toEqual([DAD, OLDER, YOUNGER, MUM])
  })

  it('inactive people are not parties', () => {
    expect(allParties(withoutYounger)).toEqual([DAD, OLDER])
  })
})

describe('scores', () => {
  it.each([
    [1, true],
    [5, true],
    [100, true],
    [0, false],
    [-5, false],
    [2.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])('%d valid: %s', (score, valid) => {
    expect(isValidScore(score)).toBe(valid)
  })
})

describe('score agreement: one giver + one taker (spec §3)', () => {
  const dadOffer = (): ScoreProposal => value(proposeScore(family, DAD, 10))
  const olderAsk = (): ScoreProposal => value(proposeScore(family, OLDER, 10))

  it('the proposer approves by proposing; a giver proposal waits for a taker', () => {
    expect(dadOffer().approvedBy).toEqual([DAD])
    expect(missingRoles(dadOffer(), family)).toEqual(['taker'])
    expect(isAgreed(dadOffer(), family)).toBe(false)
  })

  it('one taker approving a giver proposal is enough; the other taker is not needed', () => {
    const p = value(approveScore(dadOffer(), family, YOUNGER))
    expect(isAgreed(p, family)).toBe(true)
  })

  it('a taker proposal waits for a giver; more takers do not replace the giver', () => {
    expect(missingRoles(olderAsk(), family)).toEqual(['giver'])
    const bothTakers = value(approveScore(olderAsk(), family, YOUNGER))
    expect(isAgreed(bothTakers, family)).toBe(false)
    expect(isAgreed(value(approveScore(bothTakers, family, DAD)), family)).toBe(true)
  })

  it('refuses the admin, inactive people and unknown ids', () => {
    expect(approveScore(dadOffer(), family, JAKUB)).toEqual({ ok: false, error: 'not_a_party' })
    expect(approveScore(dadOffer(), withoutYounger, YOUNGER)).toEqual({
      ok: false,
      error: 'not_a_party',
    })
    expect(approveScore(dadOffer(), family, 99)).toEqual({ ok: false, error: 'not_a_party' })
    expect(proposeScore(family, JAKUB, 10)).toEqual({ ok: false, error: 'not_a_party' })
  })

  it('refuses a second approval by the same person', () => {
    expect(approveScore(dadOffer(), family, DAD)).toEqual({ ok: false, error: 'already_approved' })
  })

  it('refuses an invalid score', () => {
    expect(proposeScore(family, DAD, 0)).toEqual({ ok: false, error: 'invalid_score' })
  })

  it('is never agreed without an active taker or without an active giver', () => {
    const dadAlone: Person[] = [{ id: DAD, role: 'giver', active: true }]
    expect(isAgreed({ score: 5, proposedBy: DAD, approvedBy: [DAD] }, dadAlone)).toBe(false)
    const nobody: Person[] = [{ id: JAKUB, role: 'admin', active: true }]
    expect(isAgreed({ score: 5, proposedBy: DAD, approvedBy: [DAD] }, nobody)).toBe(false)
  })

  describe('approvals are checked live against the current people', () => {
    it("a deactivated taker's approval no longer counts", () => {
      const p = value(approveScore(dadOffer(), family, OLDER))
      expect(isAgreed(p, withoutOlder)).toBe(false)
      expect(missingRoles(p, withoutOlder)).toEqual(['taker'])
    })

    it('a taker who became admin no longer counts', () => {
      const p = value(approveScore(dadOffer(), family, OLDER))
      expect(isAgreed(p, olderNowAdmin)).toBe(false)
    })

    it('Mum, as a second giver, can be the giver who approves', () => {
      const p = value(proposeScore(withMum, OLDER, 10))
      expect(isAgreed(value(approveScore(p, withMum, MUM)), withMum)).toBe(true)
    })
  })
})

describe('recurring templates (spec §5.1)', () => {
  const proposed = (): TemplateAgreement => value(proposeTemplate(family, DAD, 5))
  const agreed = (): TemplateAgreement => value(approveTemplate(proposed(), family, OLDER))

  it('only an active giver creates a template', () => {
    expect(proposeTemplate(family, OLDER, 5)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(proposeTemplate(family, JAKUB, 5)).toEqual({ ok: false, error: 'not_a_giver' })
    const inactiveDad = family.map((p) => (p.id === DAD ? { ...p, active: false } : p))
    expect(proposeTemplate(inactiveDad, DAD, 5)).toEqual({ ok: false, error: 'not_a_giver' })
  })

  it('stays proposed and creates no instances until a taker approves', () => {
    const t = proposed()
    expect(t.status).toBe('proposed')
    expect(canCreateInstances(t)).toBe(false)
    expect(scoreForNewInstance(t)).toEqual({ ok: false, error: 'not_agreed' })
  })

  it('becomes agreed when one taker approves', () => {
    const t = agreed()
    expect(t).toEqual({ status: 'agreed', score: 5, change: null })
    expect(canCreateInstances(t)).toBe(true)
    expect(scoreForNewInstance(t)).toEqual({ ok: true, value: 5 })
  })

  it('a party approving twice is refused', () => {
    expect(approveTemplate(proposed(), family, DAD)).toEqual({
      ok: false,
      error: 'already_approved',
    })
  })

  it('approving an agreed template is refused (changes go through bidding)', () => {
    expect(approveTemplate(agreed(), family, YOUNGER)).toEqual({
      ok: false,
      error: 'not_proposed',
    })
  })

  it('resolving is a no-op when nothing changed', () => {
    const t = proposed()
    expect(resolveTemplate(t, family)).toBe(t)
    const a = agreed()
    expect(resolveTemplate(a, family)).toBe(a)
  })
})

describe('one-time tasks, path 1: score agreement (spec §5.2)', () => {
  const proposed = (): OneTimeAgreement => value(createOneTimeTask(family, DAD, 20))
  const approve = (t: OneTimeAgreement, id: number) => approveOneTimeOffer(t, family, id)

  it('only an active giver creates a task with an offer', () => {
    expect(createOneTimeTask(family, YOUNGER, 20)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(createOneTimeTask(family, JAKUB, 20)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(createOneTimeTask(family, DAD, -1)).toEqual({ ok: false, error: 'invalid_score' })
    const inactiveDad = family.map((p) => (p.id === DAD ? { ...p, active: false } : p))
    expect(createOneTimeTask(inactiveDad, DAD, 20)).toEqual({ ok: false, error: 'not_a_giver' })
  })

  it("stays proposed until a taker approves the giver's offer", () => {
    expect(proposed().status).toBe('proposed')
  })

  it('becomes open at the offered score when one taker approves', () => {
    expect(value(approve(proposed(), YOUNGER))).toEqual({ status: 'open', score: 20 })
  })

  it('cannot be approved again once open', () => {
    const open = value(approve(proposed(), YOUNGER))
    expect(approve(open, OLDER)).toEqual({ ok: false, error: 'not_proposed' })
  })

  it('refuses the admin and double approvals', () => {
    expect(approve(proposed(), JAKUB)).toEqual({ ok: false, error: 'not_a_party' })
    expect(approve(proposed(), DAD)).toEqual({ ok: false, error: 'already_approved' })
  })

  it('two givers without a taker stay unagreed', () => {
    const t = value(createOneTimeTask(withMum, DAD, 20))
    expect(value(approveOneTimeOffer(t, withMum, MUM)).status).toBe('proposed')
  })

  it('a second giver (Mum) is not needed', () => {
    const t = value(createOneTimeTask(withMum, DAD, 20))
    expect(value(approveOneTimeOffer(t, withMum, OLDER))).toEqual({ status: 'open', score: 20 })
  })

  it('never opens while there is no active taker', () => {
    const dadAlone: Person[] = [{ id: DAD, role: 'giver', active: true }]
    expect(value(createOneTimeTask(dadAlone, DAD, 20)).status).toBe('proposed')
    expect(value(proposeTemplate(dadAlone, DAD, 5)).status).toBe('proposed')
  })

  it("if the giver who offered is deactivated, the offer waits for another giver's approval", () => {
    const withMumNoDad = withMum.map((p) => (p.id === DAD ? { ...p, active: false } : p))
    const t = resolveOneTime(value(createOneTimeTask(withMum, DAD, 20)), withMumNoDad)
    expect(t.status === 'proposed' && t.offer.approvedBy).toEqual([])
    const afterTaker = value(approveOneTimeOffer(t, withMumNoDad, OLDER))
    expect(afterTaker.status).toBe('proposed')
    expect(value(approveOneTimeOffer(afterTaker, withMumNoDad, MUM))).toEqual({
      status: 'open',
      score: 20,
    })
  })

  it('resolving is a no-op when nothing changed', () => {
    const t = proposed()
    expect(resolveOneTime(t, family)).toBe(t)
  })

  it('a released bid-won task: the agreed score is the offer again, a taker must approve', () => {
    const t = reopenOneTimeOffer(family, DAD, 23)
    expect(t).toEqual({
      status: 'proposed',
      offer: { score: 23, proposedBy: DAD, approvedBy: [DAD] },
      book: { bids: [] },
    })
    expect(value(approveOneTimeOffer(t, family, YOUNGER))).toEqual({ status: 'open', score: 23 })
  })

  it('reopened by a giver who has left: needs another giver too', () => {
    const withMumNoDad = withMum.map((p) => (p.id === DAD ? { ...p, active: false } : p))
    const t = reopenOneTimeOffer(withMumNoDad, DAD, 23)
    expect(t.status === 'proposed' && t.offer.approvedBy).toEqual([])
  })
})
