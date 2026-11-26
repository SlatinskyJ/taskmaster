import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  acceptedUpdate,
  approvedMarker,
  handoffMarker,
  makeGh,
  requiredCi,
  type GhCheckRun,
  type GhCommit,
} from '../scripts/merge-queue/github.ts'

const KEY = 'test-marker-key'
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const U1 = '1'.repeat(40)
const U2 = '2'.repeat(40)
const M1 = 'd'.repeat(40)
const M2 = 'e'.repeat(40)
const OLD = 'f'.repeat(40)
const NOW = new Date('2026-11-26T12:00:00Z')

function commit(sha: string, parents: string[], over: Partial<GhCommit['commit']> = {}): GhCommit {
  return {
    sha,
    parents: parents.map((p) => ({ sha: p })),
    commit: {
      committer: { name: 'GitHub', email: 'noreply@github.com' },
      verification: { verified: true },
      ...over,
    },
  }
}

describe('acceptedUpdate', () => {
  const main = new Set([M1])
  it('accepts an API-made merge of main on top of the approved commit', () => {
    expect(acceptedUpdate(commit(U1, [A, M1]), A, main)).toBe(true)
  })
  it('rejects a commit with one parent', () => {
    expect(acceptedUpdate(commit(U1, [A]), A, main)).toBe(false)
  })
  it('rejects parents in the other order', () => {
    expect(acceptedUpdate(commit(U1, [M1, A]), A, main)).toBe(false)
  })
  it('rejects a second parent that is not on main', () => {
    expect(acceptedUpdate(commit(U1, [A, B]), A, main)).toBe(false)
  })
  it('rejects an unverified commit', () => {
    expect(
      acceptedUpdate(commit(U1, [A, M1], { verification: { verified: false } }), A, main),
    ).toBe(false)
  })
  it('rejects another committer email', () => {
    expect(
      acceptedUpdate(
        commit(U1, [A, M1], { committer: { name: 'GitHub', email: 'me@example.com' } }),
        A,
        main,
      ),
    ).toBe(false)
  })
  it('rejects another committer name', () => {
    expect(
      acceptedUpdate(
        commit(U1, [A, M1], { committer: { name: 'Mallory', email: 'noreply@github.com' } }),
        A,
        main,
      ),
    ).toBe(false)
  })
})

function checkRun(over: Partial<GhCheckRun> & { name: string }): GhCheckRun {
  return {
    id: 1,
    status: 'completed',
    conclusion: 'success',
    app: { slug: 'github-actions' },
    ...over,
  }
}

describe('requiredCi', () => {
  const names = ['lint', 'test']
  it('is green when every required check succeeded', () => {
    expect(requiredCi(names, [checkRun({ name: 'lint' }), checkRun({ name: 'test' })])).toBe(
      'green',
    )
  })
  it('counts a skipped check as passing', () => {
    expect(
      requiredCi(names, [
        checkRun({ name: 'lint', conclusion: 'skipped' }),
        checkRun({ name: 'test' }),
      ]),
    ).toBe('green')
  })
  it('counts a neutral check as passing', () => {
    expect(
      requiredCi(names, [
        checkRun({ name: 'lint', conclusion: 'neutral' }),
        checkRun({ name: 'test' }),
      ]),
    ).toBe('green')
  })
  it('is pending when a required check has no run', () => {
    expect(requiredCi(names, [checkRun({ name: 'lint' })])).toBe('pending')
  })
  it('is pending while a run is in progress', () => {
    expect(
      requiredCi(names, [
        checkRun({ name: 'lint' }),
        checkRun({ name: 'test', status: 'in_progress', conclusion: null }),
      ]),
    ).toBe('pending')
  })
  it('is red when a required check failed', () => {
    expect(
      requiredCi(names, [
        checkRun({ name: 'lint' }),
        checkRun({ name: 'test', conclusion: 'failure' }),
      ]),
    ).toBe('red')
  })
  it('uses the newest run of a name', () => {
    expect(
      requiredCi(names, [
        checkRun({ name: 'lint' }),
        checkRun({ id: 1, name: 'test', conclusion: 'failure' }),
        checkRun({ id: 2, name: 'test', conclusion: 'success' }),
      ]),
    ).toBe('green')
  })
  it('ignores a run with the right name from another app', () => {
    expect(
      requiredCi(names, [
        checkRun({ name: 'lint' }),
        checkRun({ name: 'test', app: { slug: 'evil' } }),
      ]),
    ).toBe('pending')
  })
  it('throws on an empty list of required checks', () => {
    expect(() => requiredCi([], [checkRun({ name: 'lint' })])).toThrow()
  })
})

// --- labelledPrs against a fake GitHub ---------------------------------------------------

interface Reply {
  status: number
  body?: unknown
}
interface Call {
  method: string
  url: string
  body: unknown
}

function fakeFetch(routes: Record<string, Reply>) {
  const calls: Call[] = []
  const impl = ((input: string | URL, init?: RequestInit) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, url: url.toString(), body })
    const key = `${method} ${url.pathname}`
    const reply = routes[key]
    if (!reply) {
      return Promise.resolve(new Response(JSON.stringify({ message: 'no route' }), { status: 599 }))
    }
    return Promise.resolve(
      new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
      }),
    )
  }) as typeof fetch
  return { impl, calls }
}

const R = '/repos/SlatinskyJ/taskmaster'
const LABEL_AT = '2026-11-26T10:00:00Z'

const LABEL_ID = 501

function labelEvent(login: string, at = LABEL_AT, name = 'merge-me', id = LABEL_ID) {
  return { id, event: 'labeled', label: { name }, actor: { login }, created_at: at }
}
// With a PAT the Action posts as SlatinskyJ, like the agents: only the HMAC proves a marker.
function comment(body: string, at = '2026-11-26T10:00:05Z') {
  return { user: { login: 'SlatinskyJ' }, body, created_at: at }
}
const hmac = (text: string) => createHmac('sha256', KEY).update(text).digest('hex')
const approvedOk = (sha = A, pr = 9) => comment(approvedMarker(KEY, pr, sha))

interface World {
  events?: unknown[]
  comments?: unknown[]
  commits?: GhCommit[]
  head?: string
  onMain?: string[]
}

function world(w: World = {}): Record<string, Reply> {
  const head = w.head ?? A
  const commits = w.commits ?? [
    commit(OLD, []),
    commit(A, [OLD], { committer: { name: 'Jakub', email: 'j@x' } }),
  ]
  const onMain = new Set(w.onMain ?? [M1, M2])
  const routes: Record<string, Reply> = {
    [`GET ${R}/pulls`]: { status: 200, body: [{ number: 9, labels: [{ name: 'merge-me' }] }] },
    [`GET ${R}/rules/branches/main`]: {
      status: 200,
      body: [
        { type: 'deletion' },
        {
          type: 'required_status_checks',
          parameters: { required_status_checks: [{ context: 'test' }] },
        },
      ],
    },
    [`GET ${R}/issues/9/events`]: { status: 200, body: w.events ?? [labelEvent('SlatinskyJ')] },
    [`GET ${R}/issues/9/comments`]: {
      status: 200,
      body: w.comments ?? [approvedOk()],
    },
    [`GET ${R}/pulls/9`]: {
      status: 200,
      body: {
        number: 9,
        draft: false,
        head: { sha: head },
        mergeable_state: 'clean',
        labels: [{ name: 'merge-me' }],
      },
    },
    [`GET ${R}/pulls/9/commits`]: { status: 200, body: commits },
    [`GET ${R}/commits/${head}/check-runs`]: {
      status: 200,
      body: { check_runs: [checkRun({ name: 'test' })] },
    },
    'POST /graphql': {
      status: 200,
      body: {
        data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: true }] } } } },
      },
    },
    [`GET ${R}/stacks`]: { status: 200, body: [] },
  }
  for (const c of commits) {
    for (const p of c.parents) {
      routes[`GET ${R}/compare/main...${p.sha}`] = {
        status: 200,
        body: { status: onMain.has(p.sha) ? 'behind' : 'diverged' },
      }
    }
  }
  return routes
}

async function factsOf(w: World) {
  const { impl } = fakeFetch(world(w))
  return makeGh('t', KEY, impl, { now: () => NOW }).labelledPrs()
}

const BASE_COMMITS = [
  commit(OLD, []),
  commit(A, [OLD], { committer: { name: 'Jakub', email: 'j@x' } }),
]

describe('labelledPrs', () => {
  it('reports a clean approved PR', async () => {
    expect(await factsOf({})).toEqual([
      {
        number: 9,
        draft: false,
        approvedSha: A,
        labelEventId: LABEL_ID,
        headSha: A,
        headIsApproved: true,
        updatedByAction: false,
        labelAgeMinutes: 120,
        needsJakubAfterLabel: false,
        ci: 'green',
        unresolvedThreads: 0,
        inStack: false,
        behind: false,
        handedOver: false,
      },
    ])
  })

  it('accepts a chain of update merges the Action made', async () => {
    const [pr] = await factsOf({
      head: U2,
      commits: [...BASE_COMMITS, commit(U1, [A, M1]), commit(U2, [U1, M2])],
    })
    expect(pr).toMatchObject({ headIsApproved: true, updatedByAction: true, headSha: U2 })
  })

  it('checks every commit after the approved one, not only the head', async () => {
    const [pr] = await factsOf({
      head: U2,
      commits: [
        ...BASE_COMMITS,
        commit(U1, [A, M1]),
        commit(B, [U1], { committer: { name: 'Jakub', email: 'j@x' } }),
        commit(U2, [B, M2]),
      ],
    })
    expect(pr).toMatchObject({ headIsApproved: false, updatedByAction: false })
  })

  it('rejects a head force-pushed so the approved commit is gone', async () => {
    const [pr] = await factsOf({
      head: B,
      commits: [commit(OLD, []), commit(B, [OLD], { committer: { name: 'Jakub', email: 'j@x' } })],
    })
    expect(pr).toMatchObject({ headIsApproved: false })
  })

  it('accepts an approved marker with a valid HMAC from any author', async () => {
    const [pr] = await factsOf({
      comments: [comment(`<!-- merge-queue:approved ${A} ${hmac(`approved:9:${A}`)} -->`)],
    })
    expect(pr).toMatchObject({ approvedSha: A, headIsApproved: true })
  })

  it('ignores an approved marker with a wrong HMAC', async () => {
    const [pr] = await factsOf({
      comments: [comment(`<!-- merge-queue:approved ${A} ${'0'.repeat(64)} -->`)],
    })
    expect(pr).toMatchObject({ approvedSha: null, headIsApproved: false })
  })

  it('ignores an approved marker with no HMAC', async () => {
    const [pr] = await factsOf({ comments: [comment(`<!-- merge-queue:approved ${A} -->`)] })
    expect(pr).toMatchObject({ approvedSha: null })
  })

  it('ignores an approved marker signed for another PR', async () => {
    const [pr] = await factsOf({ comments: [approvedOk(A, 8)] })
    expect(pr).toMatchObject({ approvedSha: null })
  })

  it('ignores an approved marker from before the latest label', async () => {
    const [pr] = await factsOf({
      comments: [comment(approvedMarker(KEY, 9, A), '2026-11-26T09:00:00Z')],
    })
    expect(pr).toMatchObject({ approvedSha: null })
  })

  it('leaves out a PR whose merge-me label someone else added', async () => {
    expect(await factsOf({ events: [labelEvent('somebody')] })).toEqual([])
  })

  it('counts from a later label by SlatinskyJ', async () => {
    const [pr] = await factsOf({
      events: [
        labelEvent('somebody', '2026-11-26T08:00:00Z', 'merge-me', 400),
        labelEvent('SlatinskyJ', '2026-11-26T11:00:00Z', 'merge-me', 600),
      ],
      comments: [comment(approvedMarker(KEY, 9, A), '2026-11-26T11:00:03Z')],
    })
    expect(pr).toMatchObject({ approvedSha: A, labelAgeMinutes: 60, labelEventId: 600 })
  })

  it('does not count a hand-over from before the latest label', async () => {
    const [pr] = await factsOf({
      comments: [comment(handoffMarker(KEY, 9, LABEL_ID), '2026-11-26T09:00:00Z'), approvedOk()],
    })
    expect(pr).toMatchObject({ handedOver: false })
  })

  it('counts a hand-over with a valid HMAC after the latest label', async () => {
    const [pr] = await factsOf({
      comments: [
        approvedOk(),
        comment(
          `<!-- merge-queue:handoff ${hmac(`handoff:9:${LABEL_ID}`)} -->`,
          '2026-11-26T10:30:00Z',
        ),
      ],
    })
    expect(pr).toMatchObject({ handedOver: true })
  })

  it('does not count a hand-over with a wrong or missing HMAC', async () => {
    const [pr] = await factsOf({
      comments: [
        approvedOk(),
        comment(`<!-- merge-queue:handoff ${'0'.repeat(64)} -->`, '2026-11-26T10:30:00Z'),
        comment('<!-- merge-queue:handoff -->', '2026-11-26T10:31:00Z'),
      ],
    })
    expect(pr).toMatchObject({ handedOver: false })
  })

  it('does not count a hand-over signed for an earlier label', async () => {
    const [pr] = await factsOf({
      comments: [approvedOk(), comment(handoffMarker(KEY, 9, 400), '2026-11-26T10:30:00Z')],
    })
    expect(pr).toMatchObject({ handedOver: false })
  })

  it('reports a needs-jakub label added after merge-me and still on', async () => {
    const routes = world({
      events: [
        labelEvent('SlatinskyJ'),
        labelEvent('claude', '2026-11-26T10:10:00Z', 'needs-jakub'),
      ],
    })
    routes[`GET ${R}/pulls/9`] = {
      status: 200,
      body: {
        number: 9,
        draft: false,
        head: { sha: A },
        mergeable_state: 'clean',
        labels: [{ name: 'merge-me' }, { name: 'needs-jakub' }],
      },
    }
    const { impl } = fakeFetch(routes)
    const [pr] = await makeGh('t', KEY, impl, { now: () => NOW }).labelledPrs()
    expect(pr).toMatchObject({ needsJakubAfterLabel: true })
  })

  it('reports unresolved threads, a stack and behind', async () => {
    const routes = world()
    routes['POST /graphql'] = {
      status: 200,
      body: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] },
            },
          },
        },
      },
    }
    routes[`GET ${R}/stacks`] = { status: 200, body: [{ number: 3 }] }
    routes[`GET ${R}/pulls/9`] = {
      status: 200,
      body: { number: 9, draft: false, head: { sha: A }, mergeable_state: 'behind', labels: [] },
    }
    const { impl } = fakeFetch(routes)
    const [pr] = await makeGh('t', KEY, impl, { now: () => NOW }).labelledPrs()
    expect(pr).toMatchObject({ unresolvedThreads: 1, inStack: true, behind: true })
  })
})

describe('writes', () => {
  it('updateBranch sends expected_head_sha and maps 422 to conflict', async () => {
    const { impl, calls } = fakeFetch({ [`PUT ${R}/pulls/9/update-branch`]: { status: 422 } })
    expect(await makeGh('t', KEY, impl).updateBranch(9, A)).toBe('conflict')
    expect(calls[0]?.body).toEqual({ expected_head_sha: A })
  })

  it('updateBranch returns ok on 202', async () => {
    const { impl } = fakeFetch({ [`PUT ${R}/pulls/9/update-branch`]: { status: 202, body: {} } })
    expect(await makeGh('t', KEY, impl).updateBranch(9, A)).toBe('ok')
  })

  it('merge squashes on the given sha', async () => {
    const { impl, calls } = fakeFetch({
      [`PUT ${R}/pulls/9/merge`]: { status: 200, body: { merged: true } },
    })
    expect(await makeGh('t', KEY, impl).merge(9, A)).toBe('merged')
    expect(calls[0]?.body).toEqual({ merge_method: 'squash', sha: A })
  })

  it.each([405, 409])('merge maps %i to refused', async (status) => {
    const { impl } = fakeFetch({ [`PUT ${R}/pulls/9/merge`]: { status } })
    expect(await makeGh('t', KEY, impl).merge(9, A)).toBe('refused')
  })

  it('throws with the URL and status on any other failure', async () => {
    const { impl } = fakeFetch({ [`PUT ${R}/pulls/9/merge`]: { status: 500 } })
    await expect(makeGh('t', KEY, impl).merge(9, A)).rejects.toThrow(/pulls\/9\/merge.*500/)
  })

  it('comment posts the body; removeLabel deletes the label', async () => {
    const { impl, calls } = fakeFetch({
      [`POST ${R}/issues/9/comments`]: { status: 201, body: {} },
      [`DELETE ${R}/issues/9/labels/merge-me`]: { status: 200, body: [] },
    })
    const gh = makeGh('t', KEY, impl)
    await gh.comment(9, 'hi')
    await gh.removeLabel(9, 'merge-me')
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      `POST ${R}/issues/9/comments`,
      `DELETE ${R}/issues/9/labels/merge-me`,
    ])
    expect(calls[0]?.body).toEqual({ body: 'hi' })
  })
})
