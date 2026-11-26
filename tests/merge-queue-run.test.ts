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
    inStack: false,
    behind: false,
    handedOver: false,
    ...over,
  }
}

interface Options {
  prs: PrFacts[] | (() => PrFacts[])
  update?: 'ok' | 'conflict'
  merge?: 'merged' | 'refused'
  onComment?: () => void
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
    removeLabel: (pr, label) => {
      calls.push({ op: 'removeLabel', args: [pr, label] })
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
    await run(f.gh, log, KEY, { pr: 9, sha: X })
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
    await run(f.gh, log, KEY, { pr: 9, sha: X })
    expect(f.calls.map((c) => c.op).slice(0, 3)).toEqual([
      'latestLabelEventId',
      'comment',
      'labelledPrs',
    ])
    expect(f.comments().some((b) => b.includes('approval not recorded'))).toBe(false)
  })

  it('writes no approval when the PR has no qualifying label event', async () => {
    const f = fakeGh({ prs: [], labelId: null })
    await run(f.gh, log, KEY, { pr: 9, sha: X })
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
    expect(body?.startsWith(handoffMarker(KEY, 9, 501))).toBe(true)
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
    expect(body?.startsWith(handoffMarker(KEY, 9, 501))).toBe(true)
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
    await record(f.gh, log, KEY, { pr: 9, sha: X })
    expect(f.calls.map((c) => c.op)).toEqual(['latestLabelEventId', 'comment'])
    expect(f.comments()[0]?.startsWith(approvedMarker(KEY, 9, 501, X))).toBe(true)
  })

  it('record on ten PRs in a row writes ten approvals', async () => {
    const f = fakeGh({ prs: [] })
    for (let pr = 1; pr <= 10; pr++) await record(f.gh, log, KEY, { pr, sha: X })
    expect(f.comments().filter((b) => b.includes('merge-queue:approved'))).toHaveLength(10)
  })

  it('entry with a label event only records', async () => {
    const f = fakeGh({ prs: [facts({ draft: true })] })
    const r = await entry(f.gh, log, KEY, { LABEL_PR: '9', LABEL_SHA: X })
    expect(f.calls.map((c) => c.op)).toEqual(['latestLabelEventId', 'comment'])
    expect(r).toEqual({ handedOver: [] })
  })

  it('entry without a label event runs one step', async () => {
    const f = fakeGh({ prs: [facts({ draft: true })] })
    expect(await entry(f.gh, log, KEY, {})).toEqual({ handedOver: [9] })
    expect(f.calls.some((c) => c.op === 'latestLabelEventId')).toBe(false)
  })

  it('entry refuses a malformed label event', async () => {
    const f = fakeGh({ prs: [] })
    await expect(entry(f.gh, log, KEY, { LABEL_PR: 'x', LABEL_SHA: X })).rejects.toThrow(
      'bad LABEL_PR or LABEL_SHA',
    )
  })

  it('step writes no approval', async () => {
    const f = fakeGh({ prs: [facts({ ci: 'pending' })] })
    await step(f.gh, log, KEY)
    expect(f.calls.map((c) => c.op)).toEqual(['labelledPrs'])
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
