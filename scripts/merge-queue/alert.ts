// Tells the project's coordinator that the merge-me Action handed PRs over, by firing a Claude
// scheduled task through its API trigger. That task's thread only relays the alert; it fixes
// nothing. Optional: without both secrets it does nothing. Never fails the queue step.
type Fetch = typeof fetch

// The token goes to Anthropic's fire endpoint only, never to a URL a typo or edit could swap in.
const FIRE_URL_RE =
  /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/trig_[A-Za-z0-9]+\/fire$/

export type AlertResult = 'sent' | 'skipped' | 'bad-url' | 'failed'

export function alertText(repo: string, prs: number[], runUrl: string): string {
  const links = prs.map((n) => `https://github.com/${repo}/pull/${n}`).join(' ')
  return `The merge-me Action handed over ${prs.map((n) => `#${n}`).join(', ')} (reason in each PR's hand-over comment). PRs: ${links} Run: ${runUrl}`
}

export async function alertHandback(
  fetchFn: Fetch,
  env: NodeJS.ProcessEnv,
  prs: number[],
): Promise<AlertResult> {
  const url = env.HANDBACK_FIRE_URL ?? ''
  const token = env.HANDBACK_FIRE_TOKEN ?? ''
  if (prs.length === 0 || url === '' || token === '') return 'skipped'
  if (!FIRE_URL_RE.test(url)) return 'bad-url'
  const repo = env.GITHUB_REPOSITORY ?? 'SlatinskyJ/taskmaster'
  const runUrl = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID ?? '?'}`
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: alertText(repo, prs, runUrl) }),
    })
    return res.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
