// GitHub reads for the red-main email (#338): the finished run, main's recent completed push
// runs, a re-run's earlier attempt, and the red jobs. REST over fetch; reads only.
import { isRed, type Run } from './decide.ts'

interface ApiRun {
  id: number
  run_number: number
  run_attempt: number
  head_sha: string
  display_title: string
  conclusion: string | null
  html_url: string
}

const toRun = (r: ApiRun): Run => ({
  id: r.id,
  runNumber: r.run_number,
  attempt: r.run_attempt,
  headSha: r.head_sha,
  title: r.display_title,
  conclusion: r.conclusion,
  htmlUrl: r.html_url,
})

export interface Github {
  getRun(id: number): Promise<Run>
  /** Push runs only: PR runs share the run_number counter. */
  completedRuns(): Promise<Run[]>
  attemptConclusion(id: number, attempt: number): Promise<string | null>
  failedJobs(id: number): Promise<string[]>
}

export function makeGithub(token: string, repo: string, fetchFn: typeof fetch): Github {
  const runs = `/repos/${repo}/actions/runs`
  async function get<T>(path: string): Promise<T> {
    const res = await fetchFn(`https://api.github.com${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(15_000),
    })
    // No headers and no body in the message: only what was asked and how it failed.
    if (!res.ok) throw new Error(`GitHub GET ${path}: HTTP ${String(res.status)}`)
    return (await res.json()) as T
  }
  return {
    getRun: async (id) => toRun(await get<ApiRun>(`${runs}/${String(id)}`)),
    completedRuns: async () =>
      (
        await get<{ workflow_runs: ApiRun[] }>(
          `/repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=10`,
        )
      ).workflow_runs.map(toRun),
    attemptConclusion: async (id, attempt) =>
      (
        await get<{ conclusion: string | null }>(
          `${runs}/${String(id)}/attempts/${String(attempt)}`,
        )
      ).conclusion,
    failedJobs: async (id) =>
      (
        await get<{ jobs: { name: string; conclusion: string | null }[] }>(
          `${runs}/${String(id)}/jobs?filter=latest&per_page=100`,
        )
      ).jobs
        .filter((j) => isRed(j.conclusion))
        .map((j) => j.name),
  }
}
