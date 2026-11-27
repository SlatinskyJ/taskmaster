import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeGithub } from '../scripts/red-main/github.ts'
import { main } from '../scripts/red-main/run.ts'

const TOKEN = 'ghs_secret-token-value'
const BASE = '/repos/SlatinskyJ/taskmaster/actions'
const RUNS_QUERY = `GET ${BASE}/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=10`

interface ApiRun {
  id: number
  run_number: number
  run_attempt: number
  head_sha: string
  display_title: string
  conclusion: string | null
  html_url: string
}

function apiRun(runNumber: number, conclusion: string, attempt = 1): ApiRun {
  const id = 46042649000 + runNumber
  return {
    id,
    run_number: runNumber,
    run_attempt: attempt,
    head_sha: `${String(runNumber)}${'c'.repeat(37)}`,
    display_title: `Commit ${String(runNumber)}`,
    conclusion,
    html_url: `https://github.com/SlatinskyJ/taskmaster/actions/runs/${String(id)}`,
  }
}

const JOBS = {
  jobs: [
    { name: 'lint', conclusion: 'success' },
    { name: 'build', conclusion: 'failure' },
    { name: 'test', conclusion: 'timed_out' },
    { name: 'mutation', conclusion: 'skipped' },
  ],
}

type Routes = Record<string, { status?: number; body: unknown }>

/** A fake fetch that answers only the exact method + path + query it is given. */
function fakeFetch(routes: Routes) {
  const calls: { key: string; headers: Record<string, string> }[] = []
  const fn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input)
    const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`
    calls.push({ key, headers: (init?.headers ?? {}) as Record<string, string> })
    const route = routes[key]
    if (url.origin !== 'https://api.github.com' || !route) {
      throw new Error(`unexpected call: ${key}`)
    }
    return Promise.resolve(
      new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }) as typeof fetch
  return { fn, calls, keys: () => calls.map((c) => c.key) }
}

async function setup(over: NodeJS.ProcessEnv = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'red-main-'))
  const env: NodeJS.ProcessEnv = {
    GH_TOKEN: TOKEN,
    GITHUB_REPOSITORY: 'SlatinskyJ/taskmaster',
    GITHUB_SERVER_URL: 'https://github.com',
    RUN_ID: String(46042649512),
    // The workflow passes this string on every workflow_run.
    RED_MAIN_TEST: 'false',
    MAIL_FILE: join(dir, 'mail.txt'),
    GITHUB_OUTPUT: join(dir, 'output'),
    ALERT_SMTP_USER: 'from@example.test',
    ALERT_EMAIL_TO: 'to@example.test',
    ...over,
  }
  const read = async (p: string | undefined) => {
    try {
      return await readFile(p ?? '', 'utf8')
    } catch {
      return null
    }
  }
  return { env, mailFile: () => read(env.MAIL_FILE), output: () => read(env.GITHUB_OUTPUT) }
}

function routesFor(run: ApiRun, completed: ApiRun[], extra: Routes = {}): Routes {
  return {
    [`GET ${BASE}/runs/${String(run.id)}`]: { body: run },
    [RUNS_QUERY]: { body: { workflow_runs: completed } },
    ...extra,
  }
}

describe('main', () => {
  it('red run: writes MAIL_FILE whose body lists build and test only, and sets send=true', async () => {
    const red = apiRun(512, 'failure')
    const f = fakeFetch(
      routesFor(red, [red, apiRun(511, 'success')], {
        [`GET ${BASE}/runs/${String(red.id)}/jobs?filter=latest&per_page=100`]: { body: JOBS },
      }),
    )
    const s = await setup()
    const action = await main(f.fn, s.env)
    expect(action.kind).toBe('send')
    const mail = (await s.mailFile()) ?? ''
    expect(mail).toContain('Subject: Taskmaster: main is broken (512cccc)')
    expect(mail).toContain('From: from@example.test\r\n')
    expect(mail).toContain('To: to@example.test\r\n')
    expect(mail).toContain('Failed jobs:\r\nbuild\r\ntest\r\n\r\n')
    expect(mail).not.toContain('lint')
    expect(mail).not.toContain('mutation')
    expect(mail).toContain(`https://github.com/SlatinskyJ/taskmaster/commit/${red.head_sha}`)
    expect(await s.output()).toBe('send=true\n')
    for (const c of f.calls) {
      expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`)
      expect(c.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    }
  })

  it('green after green: no MAIL_FILE and no send output', async () => {
    const green = apiRun(512, 'success')
    const f = fakeFetch(routesFor(green, [green, apiRun(511, 'success')]))
    const s = await setup()
    expect(await main(f.fn, s.env)).toEqual({ kind: 'none', reason: 'still green' })
    expect(await s.mailFile()).toBeNull()
    expect(await s.output()).toBeNull()
  })

  it.each([
    ['newest first', (red: ApiRun) => [apiRun(513, 'success'), red]],
    ['oldest first', (red: ApiRun) => [red, apiRun(513, 'success')]],
  ])('a late red run behind a newer green: none, with the runs list %s', async (_, list) => {
    const red = apiRun(512, 'failure')
    const f = fakeFetch(
      routesFor(red, list(red), {
        [`GET ${BASE}/runs/${String(red.id)}/jobs?filter=latest&per_page=100`]: { body: JOBS },
      }),
    )
    const s = await setup()
    expect(await main(f.fn, s.env)).toEqual({ kind: 'none', reason: 'newer run' })
    expect(await s.mailFile()).toBeNull()
  })

  it('the runs query is exactly branch=main&event=push&status=completed&per_page=10', async () => {
    const green = apiRun(512, 'success')
    const f = fakeFetch(routesFor(green, [green]))
    const s = await setup()
    await main(f.fn, s.env)
    expect(f.keys()).toContain(RUNS_QUERY)
  })

  it('the jobs call is made only for a red run', async () => {
    const green = apiRun(512, 'success')
    const f = fakeFetch(routesFor(green, [green, apiRun(511, 'failure')]))
    const s = await setup()
    expect((await main(f.fn, s.env)).kind).toBe('send')
    expect(f.keys().some((k) => k.includes('/jobs'))).toBe(false)
  })

  it('the attempts call is made only for a green run with run_attempt > 1, for attempt - 1', async () => {
    const first = apiRun(512, 'success', 1)
    const f1 = fakeFetch(routesFor(first, [first, apiRun(511, 'success')]))
    await main(f1.fn, (await setup()).env)
    expect(f1.keys().some((k) => k.includes('/attempts/'))).toBe(false)

    const third = apiRun(512, 'success', 3)
    const f3 = fakeFetch(
      routesFor(third, [third, apiRun(511, 'success')], {
        [`GET ${BASE}/runs/${String(third.id)}/attempts/2`]: { body: { conclusion: 'success' } },
      }),
    )
    expect(await main(f3.fn, (await setup()).env)).toEqual({ kind: 'none', reason: 'still green' })
    expect(f3.keys()).toContain(`GET ${BASE}/runs/${String(third.id)}/attempts/2`)

    const redRetry = apiRun(512, 'failure', 2)
    const fr = fakeFetch(
      routesFor(redRetry, [redRetry], {
        [`GET ${BASE}/runs/${String(redRetry.id)}/jobs?filter=latest&per_page=100`]: {
          body: JOBS,
        },
      }),
    )
    await main(fr.fn, (await setup()).env)
    expect(fr.keys().some((k) => k.includes('/attempts/'))).toBe(false)
  })

  it('green attempt 2 whose attempt 1 conclusion is failure (attempts response) writes the "green again" mail through main', async () => {
    const green = apiRun(512, 'success', 2)
    const f = fakeFetch(
      routesFor(green, [apiRun(511, 'success'), green], {
        [`GET ${BASE}/runs/${String(green.id)}/attempts/1`]: { body: { conclusion: 'failure' } },
      }),
    )
    const s = await setup()
    expect((await main(f.fn, s.env)).kind).toBe('send')
    expect(await s.mailFile()).toContain('Subject: Taskmaster: main is green again (512cccc)')
    expect(await s.output()).toBe('send=true\n')
  })

  it('RED_MAIN_TEST=true with no RUN_ID and no GH_TOKEN: zero fetch calls, MAIL_FILE holds the test mail, send=true', async () => {
    const f = fakeFetch({})
    const s = await setup({ RED_MAIN_TEST: 'true', RUN_ID: undefined, GH_TOKEN: undefined })
    expect((await main(f.fn, s.env)).kind).toBe('send')
    expect(f.calls).toEqual([])
    const mail = (await s.mailFile()) ?? ''
    expect(mail).toContain('Subject: Taskmaster: red-main test\r\n')
    expect(mail).toContain('\r\n\r\nTest of the red-main email. Nothing is broken.')
    expect(await s.output()).toBe('send=true\n')
  })

  it('throws before any fetch when GH_TOKEN or RUN_ID is missing', async () => {
    const f = fakeFetch({})
    await expect(main(f.fn, (await setup({ GH_TOKEN: '' })).env)).rejects.toThrow(
      'red-main: GH_TOKEN missing',
    )
    await expect(main(f.fn, (await setup({ RUN_ID: '' })).env)).rejects.toThrow(
      'red-main: RUN_ID missing',
    )
    expect(f.calls).toEqual([])
  })
})

describe('github', () => {
  it('an HTTP 403 throws with path and status, and the token is not in the message', async () => {
    const f = fakeFetch({ [`GET ${BASE}/runs/7`]: { status: 403, body: { message: 'nope' } } })
    const gh = makeGithub(TOKEN, 'SlatinskyJ/taskmaster', f.fn)
    const err = await gh.getRun(7).catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toBe(`GitHub GET ${BASE}/runs/7: HTTP 403`)
    expect((err as Error).message).not.toContain(TOKEN)
  })
})

describe('entry point', () => {
  it('running the script file itself (node scripts/red-main/run.ts with no GH_TOKEN) exits non-zero with "GH_TOKEN missing"', () => {
    const r = spawnSync(process.execPath, ['scripts/red-main/run.ts'], {
      env: { PATH: process.env.PATH ?? '', RUN_ID: '1' },
      encoding: 'utf8',
    })
    expect(r.stderr).toContain('GH_TOKEN missing')
    expect(r.status).not.toBe(0)
  })
})
