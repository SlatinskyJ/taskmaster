// Tells the project's coordinator that the merge-me Action handed PRs over, by firing a Claude
// scheduled task through its API trigger. That task's thread only relays the alert; it fixes
// nothing. Optional: without both secrets it does nothing. Never fails the queue step.
type Fetch = typeof fetch

// The token goes to Anthropic's fire endpoint only, never to a URL a typo or edit could swap in.
const FIRE_URL_RE =
  /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/

export const FIRE_TIMEOUT_MS = 15_000

export type AlertResult =
  | { result: 'skipped' | 'bad-url' }
  /** bare: sent without the text, after the fire with text was refused (403). */
  | { result: 'sent'; bare: boolean }
  | { result: 'failed'; detail: string }

export function alertText(repo: string, prs: number[], runUrl: string): string {
  const links = prs.map((n) => `https://github.com/${repo}/pull/${n}`).join(' ')
  return `The merge-me Action handed over ${prs.map((n) => `#${n}`).join(', ')} (reason in each PR's hand-over comment). PRs: ${links} Run: ${runUrl}`
}

export function testText(runUrl: string): string {
  return `TEST of the hand-back alert, started by hand: nothing was handed over, nothing to fix. Run: ${runUrl}`
}

export async function alertHandback(
  fetchFn: Fetch,
  env: NodeJS.ProcessEnv,
  prs: number[],
  /** Jakub's manual check (workflow_dispatch input test_alert): fires once with a TEST text. */
  test = false,
): Promise<AlertResult> {
  // A secret pasted with a trailing newline or space must still work (a newline in a header
  // makes fetch throw before it sends anything).
  const url = (env.HANDBACK_FIRE_URL ?? '').trim()
  const token = (env.HANDBACK_FIRE_TOKEN ?? '').trim()
  if ((prs.length === 0 && !test) || url === '' || token === '') return { result: 'skipped' }
  if (!FIRE_URL_RE.test(url)) return { result: 'bad-url' }
  const repo = env.GITHUB_REPOSITORY ?? 'SlatinskyJ/taskmaster'
  const runUrl = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID ?? '?'}`
  const fire = (body: object) =>
    fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      // A hung endpoint must not hold the queue job until its 5-minute limit.
      signal: AbortSignal.timeout(FIRE_TIMEOUT_MS),
    })
  try {
    const text = prs.length === 0 ? testText(runUrl) : alertText(repo, prs, runUrl)
    const res = await fire({ text })
    if (res.ok) return { result: 'sent', bare: false }
    // A task created inside a Claude project refuses a fire that carries text (403), but takes a
    // bare one. The relay then says only that a hand-back happened; the PR comments say which.
    if (res.status === 403) {
      const bare = await fire({})
      if (bare.ok) return { result: 'sent', bare: true }
      return { result: 'failed', detail: `HTTP ${bare.status}${await errorType(bare)} (bare)` }
    }
    return { result: 'failed', detail: `HTTP ${res.status}${await errorType(res)}` }
  } catch (e) {
    // Only the error's name: a message could quote the header value, which holds the token.
    return { result: 'failed', detail: e instanceof Error ? e.name : 'unknown error' }
  }
}

/** The API's error type (e.g. authentication_error), never the free-text message. */
async function errorType(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { type?: unknown } }
    const type = body.error?.type
    return typeof type === 'string' && /^[a-z_]{1,64}$/.test(type) ? ` ${type}` : ''
  } catch {
    return ''
  }
}
