import { fail, ok } from '~/domain/result'
import type { Result } from '~/domain/result'

// Opens one GitHub issue for a sent suggestion (spec §5.13). The repository is the app's own
// (ruling 3); only the token is configured. The issue gets no label and no assignee. On any
// failure it logs the HTTP status or the error's name, never the token or GitHub's answer.

export const SUGGESTIONS_REPO = 'SlatinskyJ/taskmaster'
const ISSUE_URL_PREFIX = `https://github.com/${SUGGESTIONS_REPO}/issues/`
const TIMEOUT_MS = 10_000

export type FetchFn = typeof fetch

/** The send token from the environment (`SUGGESTIONS_GITHUB_TOKEN`), or null when unset. */
export function githubToken(env: NodeJS.ProcessEnv): string | null {
  const token = env.SUGGESTIONS_GITHUB_TOKEN?.trim() ?? ''
  return token === '' ? null : token
}

function failed(why: number | string): { ok: false; error: 'github_failed' } {
  console.error('suggestions: GitHub issue failed', why)
  return fail('github_failed')
}

export async function createIssue(
  token: string,
  issue: { title: string; body: string },
  fetchFn: FetchFn = fetch,
): Promise<Result<{ url: string; number: number }, 'github_failed'>> {
  let response: Response
  try {
    response = await fetchFn(`https://api.github.com/repos/${SUGGESTIONS_REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'taskmaster',
      },
      body: JSON.stringify({ title: issue.title, body: issue.body }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    return failed(error instanceof Error ? error.name : 'unknown')
  }
  if (response.status !== 201) return failed(response.status)
  const answer: unknown = await response.json().catch(() => null)
  if (typeof answer !== 'object' || answer === null) return failed(response.status)
  const { number, html_url: url } = answer as { number?: unknown; html_url?: unknown }
  if (!Number.isInteger(number) || typeof url !== 'string' || !url.startsWith(ISSUE_URL_PREFIX)) {
    return failed(response.status)
  }
  return ok({ url, number: number as number })
}
