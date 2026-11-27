import { describe, expect, it } from 'vitest'
import {
  entryCheck,
  handoverKind,
  nextActions,
  type PrFacts,
} from '../scripts/merge-queue/decide.ts'

const A = 'a'.repeat(40)
const H = 'h'.repeat(40)
const FINAL = { kind: 'final', n: 1, redSha: null } as const

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
    stack: null,
    lower: 'none',
    behind: false,
    handover: null,
    rearms: 0,
    rearmRequest: null,
    headIsFixed: true,
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
    expect(entryCheck(facts({ draft: true }))).toEqual({
      ok: false,
      code: 'draft',
      reason: 'draft',
    })
  })
  it('fails an open question', () => {
    expect(entryCheck(facts({ needsJakubAfterLabel: true }))).toEqual({
      ok: false,
      code: 'needs-jakub',
      reason: 'open question (needs-jakub)',
    })
  })
  it('fails new commits after the label', () => {
    expect(entryCheck(facts({ headIsApproved: false }))).toEqual({
      ok: false,
      code: 'new-commits',
      reason: 'new commits after the label',
    })
  })
  it('fails red CI', () => {
    expect(entryCheck(facts({ ci: 'red' }))).toEqual({
      ok: false,
      code: 'ci-red',
      reason: 'CI red',
    })
  })
  it('fails one unresolved thread', () => {
    expect(entryCheck(facts({ unresolvedThreads: 1 }))).toEqual({
      ok: false,
      code: 'threads',
      reason: '1 unresolved thread',
    })
  })
  it('counts several unresolved threads', () => {
    expect(entryCheck(facts({ unresolvedThreads: 3 }))).toEqual({
      ok: false,
      code: 'threads',
      reason: '3 unresolved threads',
    })
  })
  it('fails a PR from a fork (its author could rewrite an update merge in the web editor)', () => {
    expect(entryCheck(facts({ fromFork: true }))).toEqual({
      ok: false,
      code: 'fork',
      reason: 'PR from a fork',
    })
  })
  it('passes a PR on a lower PR or in a stack: nextActions makes it wait', () => {
    expect(entryCheck(facts({ baseIsMain: false }))).toEqual({ ok: true })
    expect(entryCheck(facts({ stack: { number: 3, openPrs: [9] } }))).toEqual({ ok: true })
  })
})

describe('nextActions', () => {
  it('is idle with no labelled PRs', () => {
    expect(nextActions([])).toEqual([{ kind: 'idle' }])
  })

  it('hands over a PR whose approval was never recorded once the label is 15 minutes old', () => {
    expect(nextActions([facts({ approvedSha: null, labelAgeMinutes: 15 })])).toEqual([
      {
        kind: 'hand-over',
        pr: 9,
        reason: 'approval not recorded: add merge-me again',
        as: 'final',
        n: 1,
        redSha: null,
      },
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
    expect(nextActions([facts({ handover: FINAL })])).toEqual([{ kind: 'idle' }])
  })

  it('never hands over a handed-over PR a second time', () => {
    expect(nextActions([facts({ handover: FINAL, draft: true })])).toEqual([{ kind: 'idle' }])
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
    expect(nextActions([facts({ ci: 'pending' })])).toEqual([{ kind: 'wait', pr: 9, for: 'CI' }])
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
      { kind: 'hand-over', pr: 9, reason: 'draft', as: 'final', n: 1, redSha: null },
      { kind: 'update', pr: 12 },
    ])
  })

  it('keeps the PR whose update merge is in CI as the active one', () => {
    expect(
      nextActions([
        facts({ number: 7, behind: true }),
        facts({ number: 9, ci: 'pending', updatedByAction: true, headSha: H }),
      ]),
    ).toEqual([{ kind: 'wait', pr: 9, for: 'CI' }])
  })
})

describe('nextActions: stacks', () => {
  const st = (openPrs: number[]) => ({ number: 3, openPrs })

  it('waits, without a hand-over, for a stacked PR whose lower PR is not labelled', () => {
    expect(nextActions([facts({ number: 11, baseIsMain: false, stack: st([10, 11]) })])).toEqual([
      { kind: 'wait', pr: 11, for: 'its whole stack' },
    ])
  })

  it('unstacks once every open PR of the stack is labelled and passes', () => {
    const prs = [
      facts({ number: 10, stack: st([10, 11]) }),
      facts({ number: 11, baseIsMain: false, stack: st([10, 11]) }),
    ]
    expect(nextActions(prs)).toEqual([{ kind: 'unstack', stack: 3, prs: [10, 11] }])
  })

  it('does not unstack while a PR of the stack is handed over', () => {
    const prs = [
      facts({ number: 10, stack: st([10, 11]), handover: FINAL }),
      facts({ number: 11, baseIsMain: false, stack: st([10, 11]) }),
    ]
    expect(nextActions(prs)).toEqual([{ kind: 'wait', pr: 11, for: 'its whole stack' }])
  })

  it('does not unstack while a PR of the stack fails its checks (and hands that one over)', () => {
    const prs = [
      facts({ number: 10, stack: st([10, 11]), ci: 'red' }),
      facts({ number: 11, baseIsMain: false, stack: st([10, 11]) }),
    ]
    expect(nextActions(prs)).toEqual([
      { kind: 'hand-over', pr: 10, reason: 'CI red', as: 'ci', n: 1, redSha: A },
      { kind: 'wait', pr: 11, for: 'its whole stack' },
    ])
  })

  it('a PR on a lower PR (out of the stack) waits for it; the lower one lands', () => {
    const prs = [facts({ number: 10 }), facts({ number: 11, baseIsMain: false })]
    expect(nextActions(prs)).toEqual([
      { kind: 'wait', pr: 11, for: 'its lower PR to merge' },
      { kind: 'merge', pr: 10, sha: A },
    ])
  })

  it('never makes a stacked or off-main PR the active one', () => {
    const prs = [
      facts({ number: 4, baseIsMain: false, updatedByAction: true }),
      facts({ number: 9 }),
    ]
    expect(nextActions(prs).filter((a) => a.kind === 'merge')).toEqual([
      { kind: 'merge', pr: 9, sha: A },
    ])
  })
})

describe('nextActions: labelled on a lower PR', () => {
  it('hands over when its lower PR changed after the label or it was not up to date', () => {
    expect(entryCheck(facts({ lower: 'bad' }))).toEqual({
      ok: false,
      code: 'lower-bad',
      reason: 'its lower PR changed after the label, or it was not up to date with it',
    })
  })

  it('waits, even on main, while its lower PR is still open (a manual retarget)', () => {
    expect(nextActions([facts({ lower: 'pending' })])).toEqual([
      { kind: 'wait', pr: 9, for: 'its lower PR to merge' },
    ])
  })

  it('lands once its lower PR merged on the recorded head', () => {
    expect(nextActions([facts({ lower: 'ok' })])).toEqual([{ kind: 'merge', pr: 9, sha: A }])
  })
})

describe('handoverKind', () => {
  it.each([
    ['ci-red', 0, 'ci'],
    ['ci-red', 2, 'ci'],
    ['ci-red', 3, 'final'],
    ['conflict', 0, 'fix'],
    ['conflict', 2, 'fix'],
    ['conflict', 3, 'final'],
    ['merge-refused', 0, 'fix'],
    ['merge-refused', 3, 'final'],
    ['draft', 0, 'final'],
    ['threads', 0, 'final'],
    ['not-recorded', 0, 'final'],
  ] as const)('%s after %i re-arms is %s', (code, rearms, kind) => {
    expect(handoverKind(code, rearms)).toBe(kind)
  })
})

describe('nextActions: re-arm', () => {
  const ciOpen = { kind: 'ci', n: 1, redSha: A } as const
  const fixOpen = { kind: 'fix', n: 1, redSha: null } as const

  it('hands over red CI as kind ci with the red head', () => {
    expect(nextActions([facts({ ci: 'red' })])).toEqual([
      { kind: 'hand-over', pr: 9, reason: 'CI red', as: 'ci', n: 1, redSha: A },
    ])
  })

  it('hands over the 4th time as final, also for red CI', () => {
    expect(nextActions([facts({ ci: 'red', rearms: 3 })])).toEqual([
      {
        kind: 'hand-over',
        pr: 9,
        reason: 'CI red (3 re-arms used, add merge-me again)',
        as: 'final',
        n: 4,
        redSha: null,
      },
    ])
  })

  it('hands over the 3rd time still as ci', () => {
    expect(nextActions([facts({ ci: 'red', rearms: 2 })])).toEqual([
      { kind: 'hand-over', pr: 9, reason: 'CI red', as: 'ci', n: 3, redSha: A },
    ])
  })

  it('re-arms a parked PR once a newer head is green, then lands it', () => {
    expect(nextActions([facts({ handover: ciOpen, headSha: H, updatedByAction: true })])).toEqual([
      { kind: 'resume', pr: 9, n: 1, sha: H },
      { kind: 'merge', pr: 9, sha: H },
    ])
  })

  it('never re-arms a green re-run of the red head', () => {
    const actions = nextActions([facts({ handover: ciOpen, headSha: A, ci: 'green' })])
    expect(actions.some((a) => a.kind === 'resume' || a.kind === 'merge')).toBe(false)
  })

  it('updates a parked PR that is behind when no other PR is active', () => {
    expect(nextActions([facts({ handover: ciOpen, ci: 'red', behind: true })])).toEqual([
      { kind: 'update', pr: 9 },
    ])
  })

  it('a parked PR that is not behind does not hold the queue', () => {
    expect(nextActions([facts({ handover: ciOpen, ci: 'red' }), facts({ number: 10 })])).toEqual([
      { kind: 'wait', pr: 9, for: 'CI red, parked' },
      { kind: 'merge', pr: 10, sha: A },
    ])
  })

  it('an updated parked PR is never the active one ahead of a non-parked PR', () => {
    expect(
      nextActions([
        facts({ handover: ciOpen, ci: 'red', updatedByAction: true, headSha: H }),
        facts({ number: 10 }),
      ]),
    ).toEqual([
      { kind: 'wait', pr: 9, for: 'CI red, parked' },
      { kind: 'merge', pr: 10, sha: A },
    ])
  })

  it('updates a behind non-parked PR first, not the behind parked one', () => {
    const actions = nextActions([
      facts({ handover: ciOpen, ci: 'red', behind: true }),
      facts({ number: 10, behind: true }),
    ])
    expect(actions.filter((a) => a.kind === 'update')).toEqual([{ kind: 'update', pr: 10 }])
  })

  it('needs-jakub after the label blocks the automatic re-arm', () => {
    expect(
      nextActions([facts({ handover: ciOpen, headSha: H, needsJakubAfterLabel: true })]),
    ).toEqual([{ kind: 'idle' }])
  })

  it('does not re-arm a parked PR with new commits after the baseline', () => {
    expect(nextActions([facts({ handover: ciOpen, headSha: H, headIsApproved: false })])).toEqual([
      { kind: 'idle' },
    ])
  })

  it('waits on a parked PR whose newer head is still in CI', () => {
    expect(nextActions([facts({ handover: ciOpen, headSha: H, ci: 'pending' })])).toEqual([
      { kind: 'wait', pr: 9, for: 'CI' },
    ])
  })

  it('re-arms a fix hand-over on a request for the head, then waits for CI', () => {
    expect(
      nextActions([
        facts({
          handover: fixOpen,
          headSha: H,
          rearmRequest: H,
          headIsApproved: false,
          headIsFixed: true,
          ci: 'pending',
        }),
      ]),
    ).toEqual([
      { kind: 'resume', pr: 9, n: 1, sha: H },
      { kind: 'wait', pr: 9, for: 'CI' },
    ])
  })

  it.each([
    ['a stale request', { rearmRequest: A }],
    ['a head that is not fixed', { headIsFixed: false }],
    ['red CI', { ci: 'red' }],
    ['needs-jakub', { needsJakubAfterLabel: true }],
    ['a draft', { draft: true }],
    ['an unresolved thread', { unresolvedThreads: 1 }],
  ] as const)('does not re-arm a fix hand-over with %s', (_, over) => {
    expect(
      nextActions([
        facts({
          handover: fixOpen,
          headSha: H,
          rearmRequest: H,
          headIsApproved: false,
          ...over,
        }),
      ]),
    ).toEqual([{ kind: 'idle' }])
  })

  it('a request never re-arms the red head', () => {
    expect(nextActions([facts({ handover: ciOpen, headSha: A, rearmRequest: A })])).toEqual([
      { kind: 'idle' },
    ])
  })

  it('a final hand-over ignores a request', () => {
    expect(nextActions([facts({ handover: FINAL, headSha: H, rearmRequest: H })])).toEqual([
      { kind: 'idle' },
    ])
  })

  it('a hand-over from before #344 (old marker) stays handed over, with no new comment', () => {
    expect(
      nextActions([facts({ handover: { kind: 'final', n: Infinity, redSha: null }, ci: 'red' })]),
    ).toEqual([{ kind: 'idle' }])
  })
})
