// GitHub side of the merge-me Action (#253): reads the facts decide.ts needs, and does the
// four writes (update, merge, comment, unlabel). REST and GraphQL over fetch; no dependency.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Ci, PrFacts } from './decide.ts'

// The Action's token is a PAT, so its comments post as SlatinskyJ, like the agents do. A
// marker counts only when its HMAC (key MERGE_MARKER_KEY, which only the workflow holds)
// verifies; the comment author proves nothing.
function sign(key: string, text: string): string {
  return createHmac('sha256', key).update(text).digest('hex')
}
function verify(key: string, text: string, mac: string): boolean {
  const want = Buffer.from(sign(key, text), 'hex')
  const got = Buffer.from(mac, 'hex')
  return got.length === want.length && timingSafeEqual(got, want)
}
/**
 * Signed for one label event, so a marker copied after a re-label does not verify. `lower` is
 * the PR this one sat on when Jakub labelled it, with that PR's head then (its base branch's
 * tip); null when its base was main. pr 0 = no open PR had that branch: never lands.
 */
export interface Lower {
  pr: number
  sha: string
}
export function approvedMarker(
  key: string,
  pr: number,
  labelEventId: number,
  sha: string,
  lower: Lower | null = null,
): string {
  const l = lower ? `${lower.pr}@${lower.sha}` : '-'
  return `<!-- merge-queue:approved ${sha} ${l} ${sign(key, `approved:${pr}:${labelEventId}:${sha}:${l}`)} -->`
}
export function handoffMarker(key: string, pr: number, labelEventId: number): string {
  return `<!-- merge-queue:handoff ${sign(key, `handoff:${pr}:${labelEventId}`)} -->`
}
const APPROVED_RE =
  /<!-- merge-queue:approved ([0-9a-f]{40}) (\d+@[0-9a-f]{40}|-) ([0-9a-f]{64}) -->/
const HANDOFF_RE = /<!-- merge-queue:handoff ([0-9a-f]{64}) -->/
export const FOOTER = '---\n_Posted by the merge-me Action_'
export const LABEL = 'merge-me'
export const JAKUB = 'SlatinskyJ'

export interface GhCommit {
  sha: string
  parents: { sha: string }[]
  commit: {
    committer: { name: string; email: string } | null
    verification: { verified: boolean } | null
  }
}

export interface GhCheckRun {
  id: number
  name: string
  status: string
  conclusion: string | null
  app: { slug: string } | null
}

export interface Gh {
  /** Id of SlatinskyJ's latest merge-me `labeled` event on the PR; null if there is none. */
  latestLabelEventId(pr: number): Promise<number | null>
  labelledPrs(): Promise<PrFacts[]>
  updateBranch(pr: number, expectedHead: string): Promise<'ok' | 'conflict'>
  merge(pr: number, sha: string): Promise<'merged' | 'refused'>
  comment(pr: number, body: string): Promise<void>
  removeLabel(pr: number, label: string): Promise<void>
  /** The open PR whose head branch is `ref` in this repository; null if none. */
  openPrWithHead(ref: string): Promise<number | null>
  /** Takes the PRs out of the stack; their bases stay as they are. */
  unstack(stack: number, prs: number[]): Promise<void>
}

/**
 * True when `commit` is a merge of main that GitHub made through the API (update-branch) on
 * top of `base`: parents exactly [base, a commit on main], signed by GitHub. Subjects and
 * dates are never trusted.
 */
export function acceptedUpdate(commit: GhCommit, base: string, mainShas: Set<string>): boolean {
  const [first, second, ...rest] = commit.parents
  if (!first || !second || rest.length > 0) return false
  if (first.sha !== base || !mainShas.has(second.sha)) return false
  const c = commit.commit
  return (
    c.verification?.verified === true &&
    c.committer?.name === 'GitHub' &&
    c.committer.email === 'noreply@github.com'
  )
}

const PASSING = new Set(['success', 'skipped', 'neutral'])

/** CI state of the required checks, from the newest GitHub Actions run of each name. */
export function requiredCi(names: string[], runs: GhCheckRun[]): Ci {
  if (names.length === 0) throw new Error('no required status checks found on main')
  let pending = false
  for (const name of names) {
    const latest = runs
      .filter((r) => r.name === name && r.app?.slug === 'github-actions')
      .sort((a, b) => b.id - a.id)[0]
    if (latest?.status !== 'completed') pending = true
    else if (!PASSING.has(latest.conclusion ?? '')) return 'red'
  }
  return pending ? 'pending' : 'green'
}

interface IssueEvent {
  id: number
  event: string
  label?: { name: string }
  actor?: { login: string } | null
  created_at: string
}
interface IssueComment {
  user: { login: string } | null
  body?: string
  created_at: string
}
interface PullDetail {
  number: number
  draft: boolean
  head: { sha: string; repo: { full_name: string } | null }
  base: { ref: string }
  labels: { name: string }[]
}

// No parameter properties: Node's type stripping (the workflow runs this file as plain .ts) rejects them.
class HttpError extends Error {
  readonly status: number
  constructor(status: number, method: string, url: string) {
    super(`${method} ${url} → HTTP ${status}`)
    this.status = status
  }
}

export function makeGh(
  token: string,
  markerKey: string,
  fetchImpl: typeof fetch = fetch,
  opts: { repo?: string; now?: () => Date } = {},
): Gh {
  const api = 'https://api.github.com'
  const repo = opts.repo ?? 'SlatinskyJ/taskmaster'
  const [owner, name] = repo.split('/')
  const now = opts.now ?? (() => new Date())
  const base = `${api}/repos/${repo}`

  async function request(method: string, url: string, body?: unknown): Promise<Response> {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!res.ok) throw new HttpError(res.status, method, url)
    return res
  }
  async function getJson<T>(url: string): Promise<T> {
    return (await (await request('GET', url)).json()) as T
  }
  /** Every page of a list endpoint, following the Link header. */
  async function getAll<T>(url: string): Promise<T[]> {
    const out: T[] = []
    let next: string | null = `${url}${url.includes('?') ? '&' : '?'}per_page=100`
    while (next) {
      const res = await request('GET', next)
      out.push(...((await res.json()) as T[]))
      next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null
    }
    return out
  }

  let requiredNames: string[] | null = null
  async function required(): Promise<string[]> {
    if (requiredNames) return requiredNames
    const rules = await getJson<
      { type: string; parameters?: { required_status_checks?: { context: string }[] } }[]
    >(`${base}/rules/branches/main`)
    requiredNames = rules
      .filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => r.parameters?.required_status_checks ?? [])
      .map((c) => c.context)
    return requiredNames
  }

  const onMainCache = new Map<string, boolean>()
  async function isOnMain(sha: string): Promise<boolean> {
    const cached = onMainCache.get(sha)
    if (cached !== undefined) return cached
    // base...head = main...sha: 'behind' or 'identical' means sha is an ancestor of main.
    const { status } = await getJson<{ status: string }>(`${base}/compare/main...${sha}`)
    const on = status === 'behind' || status === 'identical'
    onMainCache.set(sha, on)
    return on
  }

  async function walk(
    pr: number,
    approved: string,
    head: string,
  ): Promise<{ headIsApproved: boolean; updatedByAction: boolean }> {
    if (head === approved) return { headIsApproved: true, updatedByAction: false }
    const commits = await getAll<GhCommit>(`${base}/pulls/${pr}/commits`)
    const at = commits.findIndex((c) => c.sha === approved)
    const after = at < 0 ? [] : commits.slice(at + 1)
    if (after.length === 0 || after.at(-1)?.sha !== head) {
      return { headIsApproved: false, updatedByAction: false }
    }
    const mainShas = new Set<string>()
    for (const c of after) {
      const second = c.parents[1]?.sha
      if (second && (await isOnMain(second))) mainShas.add(second)
    }
    let prev = approved
    for (const c of after) {
      if (!acceptedUpdate(c, prev, mainShas))
        return { headIsApproved: false, updatedByAction: false }
      prev = c.sha
    }
    return { headIsApproved: true, updatedByAction: true }
  }

  async function unresolvedThreads(pr: number): Promise<number> {
    const res = await request('POST', `${api}/graphql`, {
      query:
        'query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved}}}}}',
      variables: { owner, name, pr },
    })
    const json = (await res.json()) as {
      data?: {
        repository?: { pullRequest?: { reviewThreads?: { nodes: { isResolved: boolean }[] } } }
      }
      errors?: unknown
    }
    const nodes = json.data?.repository?.pullRequest?.reviewThreads?.nodes
    if (json.errors || !nodes) throw new Error(`GraphQL reviewThreads failed for PR ${pr}`)
    return nodes.filter((n) => !n.isResolved).length
  }

  interface GhStack {
    number: number
    open: boolean
    pull_requests: { number: number; state: string }[]
  }

  async function stackOf(pr: number): Promise<PrFacts['stack']> {
    let body: unknown
    try {
      body = await getJson<unknown>(`${base}/stacks?pull_request=${pr}`)
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null
      throw e
    }
    // An unknown shape throws: the run ends red and nothing is updated or merged.
    if (!Array.isArray(body)) throw new Error(`stacks for PR ${pr}: unexpected answer`)
    const open = (body as GhStack[]).filter((s) => s.open)
    if (open.length === 0) return null
    const [s] = open
    if (open.length > 1 || !s || typeof s.number !== 'number' || !Array.isArray(s.pull_requests)) {
      throw new Error(`stacks for PR ${pr}: unexpected answer`)
    }
    const openPrs = s.pull_requests.filter((p) => p.state === 'open').map((p) => p.number)
    return { number: s.number, openPrs }
  }

  // The PR sat on a lower PR when Jakub labelled it. Its diff then showed only its own changes
  // against that lower PR's head, so it may land only if it contained that head and the lower
  // PR merged on exactly that commit; otherwise code he never saw (say, removed from the lower
  // PR later) could come back with the update merge.
  async function lowerState(pr: number, lower: Lower, approved: string): Promise<PrFacts['lower']> {
    if (lower.pr <= 0 || lower.pr === pr) return 'bad'
    const { status } = await getJson<{ status: string }>(
      `${base}/compare/${lower.sha}...${approved}`,
    )
    if (status !== 'ahead' && status !== 'identical') return 'bad'
    // The lower PR may only have moved by update merges GitHub made (the same proof as for an
    // approved head), so the Action updating it with main before merging it is fine.
    const low = await getJson<{ state: string; merged_at: string | null; head: { sha: string } }>(
      `${base}/pulls/${lower.pr}`,
    )
    if (!(await walk(lower.pr, lower.sha, low.head.sha)).headIsApproved) return 'bad'
    if (low.merged_at) return 'ok'
    return low.state === 'open' ? 'pending' : 'bad'
  }

  function qualifyingLabel(events: IssueEvent[]): IssueEvent | undefined {
    return events.findLast(
      (e) => e.event === 'labeled' && e.label?.name === LABEL && e.actor?.login === JAKUB,
    )
  }

  async function factsFor(pr: number): Promise<PrFacts | null> {
    const events = await getAll<IssueEvent>(`${base}/issues/${pr}/events`)
    const label = qualifyingLabel(events)
    if (!label) return null
    const labelledAt = Date.parse(label.created_at)
    const since = (await getAll<IssueComment>(`${base}/issues/${pr}/comments`)).filter(
      (c) => Date.parse(c.created_at) >= labelledAt,
    )
    let handedOver = false
    let approvedSha: string | null = null
    let approvedLower: Lower | null = null
    for (const c of since) {
      const h = HANDOFF_RE.exec(c.body ?? '')
      if (h?.[1] && verify(markerKey, `handoff:${pr}:${label.id}`, h[1])) handedOver = true
      const a = APPROVED_RE.exec(c.body ?? '')
      if (
        a?.[1] &&
        a[2] &&
        a[3] &&
        verify(markerKey, `approved:${pr}:${label.id}:${a[1]}:${a[2]}`, a[3])
      ) {
        approvedSha = a[1]
        const [n, s] = a[2].split('@')
        approvedLower = n && s ? { pr: Number(n), sha: s } : null
      }
    }
    const detail = await getJson<PullDetail>(`${base}/pulls/${pr}`)
    const needsJakubAfterLabel =
      detail.labels.some((l) => l.name === 'needs-jakub') &&
      events.some(
        (e) =>
          e.event === 'labeled' &&
          e.label?.name === 'needs-jakub' &&
          Date.parse(e.created_at) >= labelledAt,
      )
    const facts: PrFacts = {
      number: pr,
      draft: detail.draft,
      fromFork: detail.head.repo?.full_name !== repo,
      baseIsMain: detail.base.ref === 'main',
      approvedSha,
      labelEventId: label.id,
      headSha: detail.head.sha,
      headIsApproved: false,
      updatedByAction: false,
      labelAgeMinutes: Math.floor((now().getTime() - labelledAt) / 60_000),
      needsJakubAfterLabel,
      ci: 'pending',
      unresolvedThreads: 0,
      stack: null,
      lower: 'none',
      behind: false,
      handedOver,
    }
    // decide.ts never acts on these beyond a hand-over, so skip the costly reads.
    if (handedOver || approvedSha === null) return facts
    Object.assign(facts, await walk(pr, approvedSha, detail.head.sha))
    const { check_runs } = await getJson<{ check_runs: GhCheckRun[] }>(
      `${base}/commits/${detail.head.sha}/check-runs?per_page=100`,
    )
    facts.ci = requiredCi(await required(), check_runs)
    facts.unresolvedThreads = await unresolvedThreads(pr)
    facts.stack = await stackOf(pr)
    if (approvedLower) facts.lower = await lowerState(pr, approvedLower, approvedSha)
    // Not mergeable_state: GitHub computes it lazily and answers 'unknown' right after a push.
    const { behind_by } = await getJson<{ behind_by: number }>(
      `${base}/compare/main...${detail.head.sha}`,
    )
    facts.behind = behind_by > 0
    return facts
  }

  return {
    async latestLabelEventId(pr) {
      return qualifyingLabel(await getAll<IssueEvent>(`${base}/issues/${pr}/events`))?.id ?? null
    },
    async labelledPrs() {
      const open = await getAll<{ number: number; labels: { name: string }[] }>(
        `${base}/pulls?state=open`,
      )
      const out: PrFacts[] = []
      for (const pr of open.filter((p) => p.labels.some((l) => l.name === LABEL))) {
        const f = await factsFor(pr.number)
        if (f) out.push(f)
      }
      return out
    },
    async updateBranch(pr, expectedHead) {
      try {
        await request('PUT', `${base}/pulls/${pr}/update-branch`, {
          expected_head_sha: expectedHead,
        })
        return 'ok'
      } catch (e) {
        if (e instanceof HttpError && e.status === 422) return 'conflict'
        throw e
      }
    },
    async merge(pr, sha) {
      try {
        await request('PUT', `${base}/pulls/${pr}/merge`, { merge_method: 'squash', sha })
        return 'merged'
      } catch (e) {
        if (e instanceof HttpError && (e.status === 405 || e.status === 409)) return 'refused'
        throw e
      }
    },
    async comment(pr, body) {
      await request('POST', `${base}/issues/${pr}/comments`, { body })
    },
    async removeLabel(pr, label) {
      await request('DELETE', `${base}/issues/${pr}/labels/${encodeURIComponent(label)}`)
    },
    async openPrWithHead(ref) {
      const prs = await getJson<{ number: number }[]>(
        `${base}/pulls?state=open&head=${encodeURIComponent(`${owner}:${ref}`)}`,
      )
      return prs.length === 1 && prs[0] ? prs[0].number : null
    },
    async unstack(stack, prs) {
      await request('POST', `${base}/stacks/${stack}/unstack`, { pull_requests: prs })
    },
  }
}
