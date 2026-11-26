import { describe, expect, it } from 'vitest'
import { entryCheck, nextActions, type PrFacts } from '../scripts/merge-queue/decide.ts'

const A = 'a'.repeat(40)
const H = 'h'.repeat(40)

function facts(over: Partial<PrFacts> = {}): PrFacts {
  return {
    number: 9,
    draft: false,
    approvedSha: A,
    labelEventId: 501,
    headSha: A,
    headIsApproved: true,
    updatedByAction: false,
    labelAgeMinutes: 60,
    needsJakubAfterLabel: false,
    ci: 'green',
    unresolvedThreads: 0,
    fromFork: false,
    baseIsMain: true,
    inStack: false,
    behind: false,
    handedOver: false,
    ...over,
  }
}

describe('entryCheck', () => {
  it('passes a clean PR', () => {
    expect(entryCheck(facts())).toEqual({ ok: true })
  })
  it('passes a PR whose CI is still pending', () => {
    expect(entryCheck(facts({ ci: 'pending' }))).toEqual({ ok: true })
  })
  it('fails a draft', () => {
    expect(entryCheck(facts({ draft: true }))).toEqual({ ok: false, reason: 'draft' })
  })
  it('fails an open question', () => {
    expect(entryCheck(facts({ needsJakubAfterLabel: true }))).toEqual({
      ok: false,
      reason: 'open question (needs-jakub)',
    })
  })
  it('fails new commits after the label', () => {
    expect(entryCheck(facts({ headIsApproved: false }))).toEqual({
      ok: false,
      reason: 'new commits after the label',
    })
  })
  it('fails red CI', () => {
    expect(entryCheck(facts({ ci: 'red' }))).toEqual({ ok: false, reason: 'CI red' })
  })
  it('fails one unresolved thread', () => {
    expect(entryCheck(facts({ unresolvedThreads: 1 }))).toEqual({
      ok: false,
      reason: '1 unresolved thread',
    })
  })
  it('counts several unresolved threads', () => {
    expect(entryCheck(facts({ unresolvedThreads: 3 }))).toEqual({
      ok: false,
      reason: '3 unresolved threads',
    })
  })
  it('fails a PR from a fork (its author could rewrite an update merge in the web editor)', () => {
    expect(entryCheck(facts({ fromFork: true }))).toEqual({ ok: false, reason: 'PR from a fork' })
  })
  it('fails a PR whose base is not main (a stack that is not linked)', () => {
    expect(entryCheck(facts({ baseIsMain: false }))).toEqual({
      ok: false,
      reason: 'base is not main',
    })
  })
  it('fails a PR in a GitHub stack', () => {
    expect(entryCheck(facts({ inStack: true }))).toEqual({
      ok: false,
      reason: 'in a GitHub stack',
    })
  })
})

describe('nextActions', () => {
  it('is idle with no labelled PRs', () => {
    expect(nextActions([])).toEqual([{ kind: 'idle' }])
  })

  it('hands over a PR whose approval was never recorded once the label is 15 minutes old', () => {
    expect(nextActions([facts({ approvedSha: null, labelAgeMinutes: 15 })])).toEqual([
      { kind: 'hand-over', pr: 9, reason: 'approval not recorded: add merge-me again' },
    ])
  })

  it('never approves the current head of an unrecorded PR', () => {
    const actions = nextActions([facts({ approvedSha: null, labelAgeMinutes: 99 })])
    expect(actions.some((a) => a.kind === 'merge' || a.kind === 'update')).toBe(false)
  })

  it('leaves an unrecorded PR alone while its label is under 15 minutes old', () => {
    expect(nextActions([facts({ approvedSha: null, labelAgeMinutes: 14 })])).toEqual([
      { kind: 'idle' },
    ])
  })

  it('does nothing for a handed-over PR, even one that would pass now', () => {
    expect(nextActions([facts({ handedOver: true })])).toEqual([{ kind: 'idle' }])
  })

  it('never hands over a handed-over PR a second time', () => {
    expect(nextActions([facts({ handedOver: true, draft: true })])).toEqual([{ kind: 'idle' }])
  })

  it('updates a clean PR that is behind', () => {
    expect(nextActions([facts({ behind: true })])).toEqual([{ kind: 'update', pr: 9 }])
  })

  it('merges a clean PR with green CI on the head it checked', () => {
    expect(
      nextActions([facts({ headSha: H, updatedByAction: true, headIsApproved: true })]),
    ).toEqual([{ kind: 'merge', pr: 9, sha: H }])
  })

  it('waits on a clean PR whose CI is pending', () => {
    expect(nextActions([facts({ ci: 'pending' })])).toEqual([{ kind: 'wait', pr: 9 }])
  })

  it('updates again when main moved while CI ran on its update merge', () => {
    expect(
      nextActions([facts({ ci: 'pending', behind: true, updatedByAction: true, headSha: H })]),
    ).toEqual([{ kind: 'update', pr: 9 }])
  })

  it('updates only the lowest-numbered of two clean behind PRs', () => {
    expect(
      nextActions([facts({ number: 12, behind: true }), facts({ number: 9, behind: true })]),
    ).toEqual([{ kind: 'update', pr: 9 }])
  })

  it('hands over a failing PR and moves on to the next', () => {
    expect(
      nextActions([facts({ number: 12, behind: true }), facts({ number: 9, draft: true })]),
    ).toEqual([
      { kind: 'hand-over', pr: 9, reason: 'draft' },
      { kind: 'update', pr: 12 },
    ])
  })

  it('keeps the PR whose update merge is in CI as the active one', () => {
    expect(
      nextActions([
        facts({ number: 7, behind: true }),
        facts({ number: 9, ci: 'pending', updatedByAction: true, headSha: H }),
      ]),
    ).toEqual([{ kind: 'wait', pr: 9 }])
  })
})
