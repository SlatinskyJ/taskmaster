import { describe, expect, it } from 'vitest'
import { alertHandback, alertText } from '../scripts/merge-queue/alert.ts'

const URL_OK = 'https://api.anthropic.com/v1/claude_code/routines/trig_01AbC/fire'
const ENV = {
  HANDBACK_FIRE_URL: URL_OK,
  HANDBACK_FIRE_TOKEN: 'tok',
  GITHUB_REPOSITORY: 'SlatinskyJ/taskmaster',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_RUN_ID: '42',
}

function fakeFetch(status = 200, fail = false) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (fail) return Promise.reject(new Error('network'))
    return Promise.resolve(new Response('{}', { status }))
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('hand-over alert', () => {
  it('fires the scheduled task once with the PRs and the run link', async () => {
    const f = fakeFetch()
    expect(await alertHandback(f.fn, ENV, [7, 9])).toBe('sent')
    expect(f.calls).toHaveLength(1)
    const [call] = f.calls
    if (!call) throw new Error('no call')
    expect(call.url).toBe(URL_OK)
    expect(call.init.method).toBe('POST')
    const headers = call.init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['anthropic-beta']).toBe('experimental-cc-routine-2026-04-01')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(JSON.parse(call.init.body as string)).toEqual({
      text: alertText(
        'SlatinskyJ/taskmaster',
        [7, 9],
        'https://github.com/SlatinskyJ/taskmaster/actions/runs/42',
      ),
    })
  })

  it('names every PR with its link and the run', () => {
    const t = alertText('o/r', [7, 9], 'https://run')
    expect(t).toContain('#7, #9')
    expect(t).toContain('https://github.com/o/r/pull/7 https://github.com/o/r/pull/9')
    expect(t).toContain('Run: https://run')
  })

  it('does nothing without hand-overs or without either secret', async () => {
    const f = fakeFetch()
    expect(await alertHandback(f.fn, ENV, [])).toBe('skipped')
    expect(await alertHandback(f.fn, { ...ENV, HANDBACK_FIRE_URL: '' }, [7])).toBe('skipped')
    expect(await alertHandback(f.fn, { ...ENV, HANDBACK_FIRE_TOKEN: undefined }, [7])).toBe(
      'skipped',
    )
    expect(f.calls).toHaveLength(0)
  })

  it('never sends the token to any other URL', async () => {
    const f = fakeFetch()
    for (const url of [
      'https://evil.example/v1/claude_code/routines/trig_01AbC/fire',
      'http://api.anthropic.com/v1/claude_code/routines/trig_01AbC/fire',
      `${URL_OK}?x=1`,
      'https://api.anthropic.com/v1/claude_code/routines/trig_01AbC/fire/../x',
    ]) {
      expect(await alertHandback(f.fn, { ...ENV, HANDBACK_FIRE_URL: url }, [7])).toBe('bad-url')
    }
    expect(f.calls).toHaveLength(0)
  })

  it('reports a refused or failed fire instead of throwing', async () => {
    expect(await alertHandback(fakeFetch(401).fn, ENV, [7])).toBe('failed')
    expect(await alertHandback(fakeFetch(200, true).fn, ENV, [7])).toBe('failed')
  })
})
