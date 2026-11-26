import { afterEach, describe, expect, it, vi } from 'vitest'
import { createIssue, githubToken, SUGGESTIONS_REPO } from './github'
import type { FetchFn } from './github'

// The GitHub issue client (spec §5.13, rulings 3 and 5): one request, no label, nothing secret
// in the log.
const TOKEN = 'github_pat_SECRET123'
const ISSUE = { title: 'Tmavý režim', body: 'Večer svítí.' }
const URL_OK = 'https://github.com/SlatinskyJ/taskmaster/issues/301'

function fakeFetch(answer: () => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = ((url: string, init: RequestInit) => {
    calls.push({ url, init })
    return answer()
  }) as unknown as FetchFn
  return { fn, calls }
}

const json = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createIssue', () => {
  it('sends one POST with exactly the URL, headers and body, no labels', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const { fn, calls } = fakeFetch(json(201, { number: 301, html_url: URL_OK }))
    await createIssue(TOKEN, ISSUE, fn)
    expect(SUGGESTIONS_REPO).toBe('SlatinskyJ/taskmaster')
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe('https://api.github.com/repos/SlatinskyJ/taskmaster/issues')
    expect(call?.init.method).toBe('POST')
    expect(call?.init.headers).toStrictEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'taskmaster',
    })
    expect(JSON.parse(call?.init.body as string)).toStrictEqual(ISSUE)
    expect(call?.init.redirect).toBe('error')
    expect(call?.init.signal).toBeInstanceOf(AbortSignal)
    expect(timeout).toHaveBeenCalledWith(10_000)
  })

  it('answers the issue link and number on 201', async () => {
    const { fn } = fakeFetch(json(201, { number: 301, html_url: URL_OK }))
    expect(await createIssue(TOKEN, ISSUE, fn)).toEqual({
      ok: true,
      value: { url: URL_OK, number: 301 },
    })
  })

  it.each([401, 422, 500, 200])('fails on HTTP %i and logs only the status', async (status) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { fn } = fakeFetch(json(status, { number: 301, html_url: URL_OK, token: TOKEN }))
    expect(await createIssue(TOKEN, ISSUE, fn)).toEqual({ ok: false, error: 'github_failed' })
    expect(log).toHaveBeenCalledWith('suggestions: GitHub issue failed', status)
  })

  it('fails when the fetch throws (a timeout) and logs the error name only', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { fn } = fakeFetch(() =>
      Promise.reject(new DOMException(`timed out with ${TOKEN}`, 'TimeoutError')),
    )
    expect(await createIssue(TOKEN, ISSUE, fn)).toEqual({ ok: false, error: 'github_failed' })
    expect(log).toHaveBeenCalledWith('suggestions: GitHub issue failed', 'TimeoutError')
  })

  it.each([
    ['another repository', { number: 301, html_url: 'https://github.com/other/repo/issues/301' }],
    [
      'a look-alike host',
      { number: 301, html_url: 'https://github.com.evil/SlatinskyJ/taskmaster/issues/1' },
    ],
    ['no number', { html_url: URL_OK }],
    ['a number that is not an integer', { number: '301', html_url: URL_OK }],
    ['no link', { number: 301 }],
    ['a link that is not text', { number: 301, html_url: 7 }],
  ])('fails on a 201 with %s', async (_name, body) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { fn } = fakeFetch(json(201, body))
    expect(await createIssue(TOKEN, ISSUE, fn)).toEqual({ ok: false, error: 'github_failed' })
    expect(log).toHaveBeenCalledWith('suggestions: GitHub issue failed', 201)
  })

  it('fails on a 201 whose body is not JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { fn } = fakeFetch(() => Promise.resolve(new Response('<html>', { status: 201 })))
    expect(await createIssue(TOKEN, ISSUE, fn)).toEqual({ ok: false, error: 'github_failed' })
  })

  it('never writes the token to the log', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const answer of [
      json(401, { message: TOKEN }),
      () => Promise.reject(new Error(TOKEN)),
      json(201, { number: 1, html_url: TOKEN }),
    ]) {
      await createIssue(TOKEN, ISSUE, fakeFetch(answer).fn)
    }
    expect(log).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
  })
})

describe('githubToken', () => {
  it('is the trimmed SUGGESTIONS_GITHUB_TOKEN, or null when unset or blank', () => {
    expect(githubToken({})).toBeNull()
    expect(githubToken({ SUGGESTIONS_GITHUB_TOKEN: '  ' })).toBeNull()
    expect(githubToken({ SUGGESTIONS_GITHUB_TOKEN: ' t ' })).toBe('t')
  })
})
