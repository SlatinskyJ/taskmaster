import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import type { PrFacts } from '../scripts/merge-queue/decide.ts'
import { approvedMarker, handoffMarker, type Gh } from '../scripts/merge-queue/github.ts'
import { entry, record, run, step } from '../scripts/merge-queue/run.ts'

const X = 'a'.repeat(40)
const Y = 'b'.repeat(40)
const KEY = 'test-marker-key'
const FOOTER = '---\n_Posted by the merge-me Action_'

function facts(over: Partial<PrFacts> = {}): PrFacts {
  return {
    number: 9,
    draft: false,
    fromFork: false,
    baseIsMain: true,
    approvedSha: X,
    labelEventId: 501,
    headSha: X,
    headIsApproved: true,
    updatedByAction: false,
    labelAgeMinutes: 60,
    needsJakubAfterLabel: false,
    ci: 'green',
    unresolvedThreads: 0,
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

interface Options {
  prs: PrFacts[] | (() => PrFacts[])
  update?: 'ok' | 'conflict'
  merge?: 'merged' | 'refused'
  onComment?: () => void
  onUnstack?: () => void
  lowerPr?: number | null
  labelId?: number | null
}

function fakeGh(o: Options) {
  const calls: { op: string; args: unknown[] }[] = []
  const gh: Gh = {
    latestLabelEventId: (pr) => {
      calls.push({ op: 'latestLabelEventId', args: [pr] })
      return Promise.resolve(o.labelId === undefined ? 501 : o.labelId)
    },
    labelledPrs: () => {
      calls.push({ op: 'labelledPrs', args: [] })
      return Promise.resolve(typeof o.prs === 'function' ? o.prs() : o.prs)
    },
    updateBranch: (pr, expected) => {
      calls.push({ op: 'updateBranch', args: [pr, expected] })
      return Promise.resolve(o.update ?? 'ok')
    },
    merge: (pr, sha) => {
      calls.push({ op: 'merge', args: [pr, sha] })
      return Promise.resolve(o.merge ?? 'merged')
    },
    comment: (pr, body) => {
      calls.push({ op: 'comment', args: [pr, body] })
      if (o.onComment) o.onComment()
      return Promise.resolve()
    },
    openPrWithHead: (ref) => {
      calls.push({ op: 'openPrWithHead', args: [ref] })
      return Promise.resolve(o.lowerPr === undefined ? 8 : o.lowerPr)
    },
    removeLabel: (pr, label) => {
      calls.push({ op: 'removeLabel', args: [pr, label] })
      return Promise.resolve()
    },
    unstack: (stack, prs) => {
      calls.push({ op: 'unstack', args: [stack, prs] })
      if (o.onUnstack) o.onUnstack()
      return Promise.resolve()
    },
  }
  const writes = () => calls.filter((c) => c.op !== 'labelledPrs' && c.op !== 'latestLabelEventId')
  const comments = () => calls.filter((c) => c.op === 'comment').map((c) => c.args[1] as string)
  return { gh, calls, writes, comments }
}

const lines: string[] = []
const log = (line: string) => {
  lines.push(line)
}

describe('run', () => {
  it('records the approval for the labelled commit first, whatever the head is now', async () => {
    const f = fakeGh({ prs: [facts({ headSha: Y, approvedSha: X, headIsApproved: false })] })
    await run(f.gh, log, KEY, { pr: 9, sha: X, base: { ref: 'main', sha: Y } })
    const first = f.writes()[0]
    expect(first?.op).toBe('comment')
    expect(first?.args[0]).toBe(9)
    const body = first?.args[1] as string
    expect(body.startsWith(approvedMarker(KEY, 9, 501, X))).toBe(true)
    expect(body.endsWith(FOOTER)).toBe(true)
  })

  it('reads the PRs only after writing the marker, so the label run never says not recorded', async () => {
    let marked = false
    const f = fakeGh({
      prs: () => [facts({ approvedSha: marked ? X : null, labelAgeMinutes: 20 })],
      onComment: () => {
        marked = true
      },
    })
    await run(f.gh, log, KEY, { pr: 9, sha: X, base: { ref: 'main', sha: Y } })
    expect(f.calls.map((c) => c.op).slice(0, 3)).toEqual([
      'latestLabelEventId',
      'comment',
      'labelledPrs',
    ])
    expect(f.comments().some((b) => b.includes('approval not recorded'))).toBe(false)
  })

  it('writes no approval when the PR has no qualifying label event', async () => {
    const f = fakeGh({ prs: [], labelId: null })
    await run(f.gh, log, KEY, { pr: 9, sha: X, base: { ref: 'main', sha: Y } })
    expect(f.writes()).toEqual([])
  })

  it('does nothing for an unrecorded approval while the label is under 15 minutes old', async () => {
    const f = fakeGh({ prs: [facts({ approvedSha: null, labelAgeMinutes: 5 })] })
    await run(f.gh, log, KEY)
    expect(f.writes()).toEqual([])
  })

  it('hands over an unrecorded approval once the label is 15 minutes old, without approving', async () => {
    const f = fakeGh({ prs: [facts({ approvedSha: null, labelAgeMinutes: 20 })] })
    await run(f.gh, log, KEY)
    expect(f.writes().map((c) => c.op)).toEqual(['comment'])
    const [body] = f.comments()
    expect(body?.startsWith(handoffMarker(KEY, 9, 501, 'final', 1, null))).toBe(true)
    expect(body).toContain('approval not recorded: add merge-me again')
    expect(body).not.toContain('merge-queue:approved')
  })

  it('updates a behind PR with its current head as the expected head', async () => {
    const f = fakeGh({ prs: [facts({ behind: true, headSha: Y, updatedByAction: true })] })
    await run(f.gh, log, KEY)
    expect(f.writes()).toEqual([{ op: 'updateBranch', args: [9, Y] }])
  })

  it('hands over once on an update conflict and keeps the label', async () => {
    const f = fakeGh({ prs: [facts({ behind: true })], update: 'conflict' })
    await run(f.gh, log, KEY)
    expect(f.writes().map((c) => c.op)).toEqual(['updateBranch', 'comment'])
    const [body] = f.comments()
    expect(body?.startsWith(handoffMarker(KEY, 9, 501, 'final', 1, null))).toBe(true)
    expect(body).toContain('update with main has a conflict')
    expect(body).toContain('Run skill merge-approved-prs for this PR.')
    expect(body?.endsWith(FOOTER)).toBe(true)
  })

  it('takes merge-me off after its own merge', async () => {
    const f = fakeGh({ prs: [facts()] })
    await run(f.gh, log, KEY)
    expect(f.writes()).toEqual([
      { op: 'merge', args: [9, X] },
      { op: 'removeLabel', args: [9, 'merge-me'] },
    ])
  })

  it('hands over when the merge is refused', async () => {
    const f = fakeGh({ prs: [facts()], merge: 'refused' })
    await run(f.gh, log, KEY)
    expect(f.writes().map((c) => c.op)).toEqual(['merge', 'comment'])
    expect(f.comments()[0]).toContain('merge refused (the head moved, or the ruleset blocked it)')
  })

  it('posts one comment for a hand-over and keeps the label', async () => {
    const f = fakeGh({ prs: [facts({ draft: true })] })
    await run(f.gh, log, KEY)
    expect(f.writes().map((c) => c.op)).toEqual(['comment'])
    expect(f.comments()[0]).toContain('draft')
  })

  it('returns the handed-over PRs, so the entry point can end the run red', async () => {
    const f = fakeGh({ prs: [facts({ number: 7, draft: true }), facts({ number: 9 })] })
    expect(await run(f.gh, log, KEY)).toEqual({ handedOver: [7] })
  })

  it('returns no hand-overs after a clean merge', async () => {
    const f = fakeGh({ prs: [facts()] })
    expect(await run(f.gh, log, KEY)).toEqual({ handedOver: [] })
  })

  it('writes nothing while waiting', async () => {
    const f = fakeGh({ prs: [facts({ ci: 'pending' })] })
    await run(f.gh, log, KEY)
    expect(f.writes()).toEqual([])
  })

  it('writes nothing when idle', async () => {
    const f = fakeGh({ prs: [] })
    await run(f.gh, log, KEY)
    expect(f.writes()).toEqual([])
  })
})

describe('record and step', () => {
  it('record writes only the approval and reads no other PR', async () => {
    const f = fakeGh({ prs: [facts({ number: 7, draft: true }), facts()] })
    await record(f.gh, log, KEY, { pr: 9, sha: X, base: { ref: 'main', sha: Y } })
    expect(f.calls.map((c) => c.op)).toEqual(['latestLabelEventId', 'comment'])
    expect(f.comments()[0]?.startsWith(approvedMarker(KEY, 9, 501, X))).toBe(true)
  })

  it('record on ten PRs in a row writes ten approvals', async () => {
    const f = fakeGh({ prs: [] })
    for (let pr = 1; pr <= 10; pr++)
      await record(f.gh, log, KEY, { pr, sha: X, base: { ref: 'main', sha: Y } })
    expect(f.comments().filter((b) => b.includes('merge-queue:approved'))).toHaveLength(10)
  })

  it('entry with a label event only records', async () => {
    const f = fakeGh({ prs: [facts({ draft: true })] })
    const r = await entry(f.gh, log, KEY, {
      LABEL_PR: '9',
      LABEL_SHA: X,
      LABEL_BASE_REF: 'main',
      LABEL_BASE_SHA: Y,
    })
    expect(f.calls.map((c) => c.op)).toEqual(['latestLabelEventId', 'comment'])
    expect(r).toEqual({ handedOver: [] })
  })

  it('entry without a label event runs one step', async () => {
    const f = fakeGh({ prs: [facts({ draft: true })] })
    expect(await entry(f.gh, log, KEY, {})).toEqual({ handedOver: [9] })
    expect(f.calls.some((c) => c.op === 'latestLabelEventId')).toBe(false)
  })

  it('entry records the lower PR head for a PR on another branch, none on main', async () => {
    const f = fakeGh({ prs: [] })
    await entry(f.gh, log, KEY, {
      LABEL_PR: '9',
      LABEL_SHA: X,
      LABEL_BASE_REF: '41-low',
      LABEL_BASE_SHA: Y,
    })
    await entry(f.gh, log, KEY, {
      LABEL_PR: '9',
      LABEL_SHA: X,
      LABEL_BASE_REF: 'main',
      LABEL_BASE_SHA: Y,
    })
    const [onLower, onMain] = f.comments()
    expect(onLower?.startsWith(approvedMarker(KEY, 9, 501, X, { pr: 8, sha: Y }))).toBe(true)
    expect(onMain?.startsWith(approvedMarker(KEY, 9, 501, X, null))).toBe(true)
  })

  it('records pr 0 (never lands) when no open PR has the base branch', async () => {
    const f = fakeGh({ prs: [], lowerPr: null })
    await record(f.gh, log, KEY, { pr: 9, sha: X, base: { ref: '41-low', sha: Y } })
    expect(f.comments()[0]?.startsWith(approvedMarker(KEY, 9, 501, X, { pr: 0, sha: Y }))).toBe(
      true,
    )
  })

  it('entry refuses a label event without its base', async () => {
    const f = fakeGh({ prs: [] })
    await expect(entry(f.gh, log, KEY, { LABEL_PR: '9', LABEL_SHA: X })).rejects.toThrow(
      'bad LABEL_PR',
    )
  })

  it('entry refuses a malformed label event', async () => {
    const f = fakeGh({ prs: [] })
    await expect(
      entry(f.gh, log, KEY, {
        LABEL_PR: 'x',
        LABEL_SHA: X,
        LABEL_BASE_REF: 'main',
        LABEL_BASE_SHA: Y,
      }),
    ).rejects.toThrow('bad LABEL_PR, LABEL_SHA')
  })

  it('step writes no approval', async () => {
    const f = fakeGh({ prs: [facts({ ci: 'pending' })] })
    await step(f.gh, log, KEY)
    expect(f.calls.map((c) => c.op)).toEqual(['labelledPrs'])
  })
})

describe('step: stacks', () => {
  it('unstacks, reads the PRs again and moves the bottom PR in the same run', async () => {
    let unstacked = false
    const st = { number: 3, openPrs: [10, 11] }
    const f = fakeGh({
      prs: () =>
        unstacked
          ? [facts({ number: 10 }), facts({ number: 11, baseIsMain: false })]
          : [facts({ number: 10, stack: st }), facts({ number: 11, baseIsMain: false, stack: st })],
      onUnstack: () => {
        unstacked = true
      },
    })
    expect(await step(f.gh, log, KEY)).toEqual({ handedOver: [] })
    expect(f.writes()).toEqual([
      { op: 'unstack', args: [3, [10, 11]] },
      { op: 'merge', args: [10, X] },
      { op: 'removeLabel', args: [10, 'merge-me'] },
    ])
  })

  it('unstacks at most once per run, and skips updates and merges in that pass', async () => {
    const st = { number: 3, openPrs: [10] }
    const f = fakeGh({
      prs: [facts({ number: 9, behind: true }), facts({ number: 10, stack: st })],
    })
    await step(f.gh, log, KEY)
    expect(f.writes().map((c) => c.op)).toEqual(['unstack', 'updateBranch'])
  })
})

describe('entry point', () => {
  // Vitest transpiles TypeScript itself; the workflow runs the file with plain `node`, whose type
  // stripping rejects some syntax (parameter properties, enums). Load it the way the workflow does.
  it('loads under plain node and refuses to run without its secrets', () => {
    const r = spawnSync(process.execPath, ['scripts/merge-queue/run.ts'], {
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    })
    expect(r.stderr).toContain('merge-queue: GH_TOKEN and MERGE_MARKER_KEY are required')
    expect(r.status).toBe(1)
  })
})
