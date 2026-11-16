import { describe, expect, it } from 'vitest'
import type { OneTimeAgreement, ScoreProposal, TemplateAgreement } from './agreement'
import {
  approveOneTimeOffer,
  approveScore,
  approveTemplate,
  canCreateInstances,
  createOneTimeTask,
  isAgreed,
  isValidScore,
  missingApprovals,
  proposeScore,
  proposeTemplate,
  proposeTemplateScoreChange,
  scoreForNewInstance,
  settleOneTime,
  settleTemplate,
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

function value<T>(result: Result<T, string>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}

/** Applies approvals in order, failing the test on any error. */
function approveAll<T>(
  start: T,
  ids: number[],
  approve: (t: T, id: number) => Result<T, string>,
): T {
  return ids.reduce((t, id) => value(approve(t, id)), start)
}

describe('parties (spec §3)', () => {
  it('all parties = active givers + active takers; the admin never counts', () => {
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

describe('score proposals', () => {
  const offer = (): ScoreProposal => value(proposeScore(family, DAD, 10))

  it('the proposer approves by proposing', () => {
    expect(offer().approvedBy).toEqual([DAD])
    expect(missingApprovals(offer(), family)).toEqual([OLDER, YOUNGER])
    expect(isAgreed(offer(), family)).toBe(false)
  })

  it('is agreed once every party approved, in any order', () => {
    const p = approveAll(offer(), [YOUNGER, OLDER], (t, id) => approveScore(t, family, id))
    expect(isAgreed(p, family)).toBe(true)
  })

  it('refuses the admin, inactive people and unknown ids', () => {
    expect(approveScore(offer(), family, JAKUB)).toEqual({ ok: false, error: 'not_a_party' })
    expect(approveScore(offer(), withoutYounger, YOUNGER)).toEqual({
      ok: false,
      error: 'not_a_party',
    })
    expect(approveScore(offer(), family, 99)).toEqual({ ok: false, error: 'not_a_party' })
    expect(proposeScore(family, JAKUB, 10)).toEqual({ ok: false, error: 'not_a_party' })
  })

  it('refuses a second approval by the same person', () => {
    expect(approveScore(offer(), family, DAD)).toEqual({ ok: false, error: 'already_approved' })
  })

  it('refuses an invalid score', () => {
    expect(proposeScore(family, DAD, 0)).toEqual({ ok: false, error: 'invalid_score' })
  })

  it('never counts as agreed with no parties at all', () => {
    const nobody: Person[] = [{ id: JAKUB, role: 'admin', active: true }]
    expect(isAgreed({ score: 5, proposedBy: DAD, approvedBy: [DAD] }, nobody)).toBe(false)
  })

  describe('when the parties change mid-proposal (live evaluation)', () => {
    it('a newly added party must approve too', () => {
      const p = approveAll(offer(), [OLDER, YOUNGER], (t, id) => approveScore(t, family, id))
      expect(isAgreed(p, family)).toBe(true)
      expect(isAgreed(p, withMum)).toBe(false)
      expect(missingApprovals(p, withMum)).toEqual([MUM])
    })

    it('a deactivated party is no longer needed', () => {
      const p = value(approveScore(offer(), family, OLDER))
      expect(isAgreed(p, family)).toBe(false)
      expect(isAgreed(p, withoutYounger)).toBe(true)
    })

    it("a deactivated party's earlier approval no longer counts", () => {
      const p = value(approveScore(offer(), family, YOUNGER))
      expect(missingApprovals(p, withoutYounger)).toEqual([OLDER])
    })
  })
})

describe('recurring templates (spec §5.1)', () => {
  const proposed = (): TemplateAgreement => value(proposeTemplate(family, DAD, 5))
  const approve = (people: Person[]) => (t: TemplateAgreement, id: number) =>
    approveTemplate(t, people, id)
  const agreed = (): TemplateAgreement => approveAll(proposed(), [OLDER, YOUNGER], approve(family))

  it('only an active giver creates a template', () => {
    expect(proposeTemplate(family, OLDER, 5)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(proposeTemplate(family, JAKUB, 5)).toEqual({ ok: false, error: 'not_a_giver' })
    const inactiveDad = family.map((p) => (p.id === DAD ? { ...p, active: false } : p))
    expect(proposeTemplate(inactiveDad, DAD, 5)).toEqual({ ok: false, error: 'not_a_giver' })
  })

  it('stays proposed and creates no instances until every party approves', () => {
    const t = value(approveTemplate(proposed(), family, OLDER))
    expect(t.status).toBe('proposed')
    expect(canCreateInstances(t)).toBe(false)
    expect(scoreForNewInstance(t)).toEqual({ ok: false, error: 'not_agreed' })
  })

  it('becomes agreed when the last party approves', () => {
    const t = agreed()
    expect(t).toEqual({ status: 'agreed', score: 5, pendingChange: null })
    expect(canCreateInstances(t)).toBe(true)
    expect(scoreForNewInstance(t)).toEqual({ ok: true, value: 5 })
  })

  it('a party approving twice is refused', () => {
    expect(approveTemplate(proposed(), family, DAD)).toEqual({
      ok: false,
      error: 'already_approved',
    })
  })

  it('approving an agreed template with no change pending is refused', () => {
    expect(approveTemplate(agreed(), family, OLDER)).toEqual({
      ok: false,
      error: 'no_change_pending',
    })
  })

  describe('score change', () => {
    const changing = (): TemplateAgreement =>
      value(proposeTemplateScoreChange(agreed(), family, OLDER, 8))

    it('keeps the old score in force until all parties approve the new one', () => {
      const t = value(approveTemplate(changing(), family, DAD))
      expect(t.status === 'agreed' && t.score).toBe(5)
      expect(scoreForNewInstance(t)).toEqual({ ok: true, value: 5 })
      expect(canCreateInstances(t)).toBe(true)
    })

    it('[call] applies to instances created after it is agreed; earlier ones keep theirs', () => {
      const before = value(scoreForNewInstance(changing()))
      const t = approveAll(changing(), [DAD, YOUNGER], approve(family))
      expect(t).toEqual({ status: 'agreed', score: 8, pendingChange: null })
      expect(before).toBe(5) // an instance created earlier stored 5 and keeps it
      expect(value(scoreForNewInstance(t))).toBe(8)
    })

    it('only one change at a time, only on an agreed template, only to a new value', () => {
      expect(proposeTemplateScoreChange(changing(), family, DAD, 9)).toEqual({
        ok: false,
        error: 'change_pending',
      })
      expect(proposeTemplateScoreChange(proposed(), family, DAD, 9)).toEqual({
        ok: false,
        error: 'not_agreed',
      })
      expect(proposeTemplateScoreChange(agreed(), family, DAD, 5)).toEqual({
        ok: false,
        error: 'same_score',
      })
      expect(proposeTemplateScoreChange(agreed(), family, DAD, 0)).toEqual({
        ok: false,
        error: 'invalid_score',
      })
    })

    it('the admin can neither propose nor approve a change', () => {
      expect(proposeTemplateScoreChange(agreed(), family, JAKUB, 9)).toEqual({
        ok: false,
        error: 'not_a_party',
      })
      expect(approveTemplate(changing(), family, JAKUB)).toEqual({
        ok: false,
        error: 'not_a_party',
      })
    })
  })

  describe('when the parties change', () => {
    it('Mum added mid-proposal: the template waits for her too', () => {
      const t = value(approveTemplate(proposed(), withMum, OLDER))
      const afterYounger = value(approveTemplate(t, withMum, YOUNGER))
      expect(afterYounger.status).toBe('proposed')
      expect(value(approveTemplate(afterYounger, withMum, MUM)).status).toBe('agreed')
    })

    it('a deactivated party: settling promotes a proposal everyone left has approved', () => {
      const t = value(approveTemplate(proposed(), family, OLDER))
      expect(t.status).toBe('proposed')
      expect(settleTemplate(t, withoutYounger)).toEqual({
        status: 'agreed',
        score: 5,
        pendingChange: null,
      })
    })

    it('settling also applies a score change that is now fully approved', () => {
      const t = value(
        approveTemplate(value(proposeTemplateScoreChange(agreed(), family, DAD, 8)), family, OLDER),
      )
      expect(settleTemplate(t, family)).toBe(t)
      expect(settleTemplate(t, withoutYounger)).toEqual({
        status: 'agreed',
        score: 8,
        pendingChange: null,
      })
    })
  })
})

describe('one-time tasks, path 1: all-party approval (spec §5.2)', () => {
  const proposed = (): OneTimeAgreement => value(createOneTimeTask(family, DAD, 20))
  const approve = (t: OneTimeAgreement, id: number) => approveOneTimeOffer(t, family, id)

  it('only an active giver creates a task with an offer', () => {
    expect(createOneTimeTask(family, YOUNGER, 20)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(createOneTimeTask(family, JAKUB, 20)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(createOneTimeTask(family, DAD, -1)).toEqual({ ok: false, error: 'invalid_score' })
  })

  it('stays proposed until every party approves the offer', () => {
    expect(proposed().status).toBe('proposed')
    expect(value(approve(proposed(), OLDER)).status).toBe('proposed')
  })

  it('becomes open at the offered score when the last party approves', () => {
    expect(approveAll(proposed(), [YOUNGER, OLDER], approve)).toEqual({
      status: 'open',
      score: 20,
    })
  })

  it('cannot be approved again once open', () => {
    const open = approveAll(proposed(), [YOUNGER, OLDER], approve)
    expect(approve(open, OLDER)).toEqual({ ok: false, error: 'not_proposed' })
  })

  it('refuses the admin and double approvals', () => {
    expect(approve(proposed(), JAKUB)).toEqual({ ok: false, error: 'not_a_party' })
    expect(approve(proposed(), DAD)).toEqual({ ok: false, error: 'already_approved' })
  })

  it('a second giver (Mum) must approve the offer too', () => {
    const t = value(createOneTimeTask(withMum, DAD, 20))
    const allTakers = approveAll(t, [OLDER, YOUNGER], (x, id) =>
      approveOneTimeOffer(x, withMum, id),
    )
    expect(allTakers.status).toBe('proposed')
    expect(value(approveOneTimeOffer(allTakers, withMum, MUM))).toEqual({
      status: 'open',
      score: 20,
    })
  })

  it('settling after a deactivation opens a task everyone left has approved', () => {
    const t = value(approve(proposed(), OLDER))
    expect(settleOneTime(t, family)).toBe(t)
    expect(settleOneTime(t, withoutYounger)).toEqual({ status: 'open', score: 20 })
  })
})
