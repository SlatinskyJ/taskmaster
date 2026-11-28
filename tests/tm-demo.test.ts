import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const TM_DEMO = resolve('deploy/demo/tm-demo')
const TM_PROD_REAL = resolve('deploy/prod/tm-prod')

/** Stub `docker`: logs its argv, answers the few calls the controllers make. */
const DOCKER_STUB = `#!/usr/bin/env bash
echo "docker $*" >> "$HOME/calls.log"
case "$1 $2" in
  "compose ps") echo abc ;;
  "volume rm")
    case "\${STUB_VOLUME_RM:-ok}" in
      missing) echo "Error: No such volume: $3" >&2; exit 1 ;;
      inuse) echo "Error response from daemon: remove $3: volume is in use - [abc]" >&2; exit 1 ;;
    esac ;;
esac
case "$1" in
  logs) echo "app log line" ;;
  inspect) echo "\${STUB_INSPECT:-healthy}" ;;
esac
exit 0
`

/** Stub `tm-prod`: logs its argv; `status` reports $STUB_HEALTH; exits $STUB_EXIT. */
const TM_PROD_STUB = `#!/usr/bin/env bash
echo "tm-prod $*" >> "$HOME/calls.log"
case "$1" in
  status) echo "image: x"; echo "health: \${STUB_HEALTH:-healthy}" ;;
  version) echo "prodhash" ;;
esac
exit "\${STUB_EXIT:-0}"
`

interface Run {
  status: number | null
  stdout: string
  stderr: string
  calls: string[]
  ms: number
}

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'tm-demo-'))
  writeFileSync(join(home, 'docker'), DOCKER_STUB)
  writeFileSync(join(home, 'tm-prod'), TM_PROD_STUB)
  // The repo copy of tm-prod is not executable; the host installs it 0755.
  writeFileSync(
    join(home, 'tm-prod-real'),
    `#!/usr/bin/env bash\nexec bash "${TM_PROD_REAL}" "$@"\n`,
  )
  for (const f of ['docker', 'tm-prod', 'tm-prod-real']) chmodSync(join(home, f), 0o755)
  return home
}

function calls(home: string): string[] {
  const file = join(home, 'calls.log')
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : []
}

function run(
  home: string,
  args: string[],
  env: Record<string, string> = {},
  script = TM_DEMO,
): Run {
  const started = Date.now()
  const r = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${home}:${process.env.PATH ?? ''}`,
      HOME: home,
      TM_APP_DIR: home,
      TM_PROD: join(home, 'tm-prod'),
      TM_HEALTH_WAIT: '5',
      TM_LOCK_WAIT: '5',
      ...env,
    },
  })
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    calls: calls(home),
    ms: Date.now() - started,
  }
}

/** Holds the controllers' lock in a child; resolves once the child holds it. */
let holder: ChildProcess | undefined
async function holdLock(home: string, seconds: number): Promise<void> {
  holder = spawn(
    'flock',
    [join(home, '.tm-prod.lock'), '-c', `touch "${home}/locked"; sleep ${String(seconds)}`],
    { stdio: 'ignore' },
  )
  const deadline = Date.now() + 5000
  while (!existsSync(join(home, 'locked'))) {
    if (Date.now() > deadline) throw new Error('lock holder did not start')
    await new Promise((r) => setTimeout(r, 20))
  }
}

afterEach(() => {
  holder?.kill()
  holder = undefined
})

function indexOfCall(list: string[], call: string): number {
  return list.findIndex((c) => c === call)
}

describe('tm-demo reset', () => {
  it('reset recreates the data volume and waits for healthy', () => {
    const home = makeHome()
    const r = run(home, ['reset'], { STUB_HEALTH: 'healthy' })
    expect(r.stderr).not.toContain('error')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('reset: done')
    const rm = indexOfCall(r.calls, 'docker compose rm -s -f taskmaster')
    const vol = indexOfCall(r.calls, 'docker volume rm taskmaster_tm-data')
    const up = indexOfCall(r.calls, 'docker compose up -d --no-deps taskmaster')
    expect(rm).toBeGreaterThanOrEqual(0)
    expect(vol).toBeGreaterThan(rm)
    expect(up).toBeGreaterThan(vol)
  })

  it('reset uses TM_DATA_VOLUME', () => {
    const home = makeHome()
    const r = run(home, ['reset'], { TM_DATA_VOLUME: 'demo_vol' })
    expect(r.status).toBe(0)
    expect(r.calls).toContain('docker volume rm demo_vol')
  })

  it.each(['starting', 'unhealthy'])(
    'reset fails and keeps the log on the host when the app stays %s',
    (health) => {
      const home = makeHome()
      const r = run(home, ['reset'], { STUB_HEALTH: health, TM_HEALTH_WAIT: '2' })
      expect(r.status).toBe(1)
      expect(r.stdout).not.toContain('reset: done')
      expect(r.stdout).not.toContain('app log line')
      const log = /(\S*logs\/reset-\S+\.log)/.exec(r.stderr)?.[1]
      expect(log).toBeDefined()
      expect(log?.startsWith(join(home, 'logs/reset-'))).toBe(true)
      expect(readFileSync(log ?? '', 'utf8')).toContain('app log line')
    },
  )

  it('reset goes on when the volume is already gone', () => {
    const home = makeHome()
    const r = run(home, ['reset'], { STUB_VOLUME_RM: 'missing', STUB_HEALTH: 'healthy' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('reset: done')
    expect(r.stderr).toContain('WARNING')
    expect(r.calls).toContain('docker compose up -d --no-deps taskmaster')
  })

  it('reset stops when the volume cannot be removed', () => {
    const home = makeHome()
    const r = run(home, ['reset'], { STUB_VOLUME_RM: 'inuse' })
    expect(r.status).toBe(1)
    expect(r.stdout).not.toContain('reset: done')
    expect(r.stderr).toContain('could not remove the data volume')
    expect(r.calls.filter((c) => c === 'docker compose up -d --no-deps taskmaster')).toHaveLength(1)
  })

  it('reset with the real tm-prod reads its health line', () => {
    const home = makeHome()
    const r = run(home, ['reset'], { TM_PROD: join(home, 'tm-prod-real'), STUB_INSPECT: 'healthy' })
    expect(r.stderr).not.toContain('error')
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('reset: done')
  })
})

describe('tm-demo lock', () => {
  it('reset gives up when a deploy holds the lock too long', async () => {
    const home = makeHome()
    await holdLock(home, 5)
    const r = run(home, ['reset'], { TM_LOCK_WAIT: '1' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('lock')
    expect(r.calls.filter((c) => c.startsWith('docker'))).toEqual([])
  })

  it('reset waits for a deploy to finish, then runs', async () => {
    const home = makeHome()
    await holdLock(home, 2)
    const r = run(home, ['reset'], { TM_LOCK_WAIT: '10' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('reset: done')
    expect(r.ms).toBeGreaterThanOrEqual(1500)
  })

  it('tm-demo and tm-prod lock the same file', () => {
    // Literal text, not a template: both scripts must name the same lock file.
    const lockFile = '${HOME}/.tm-prod.lock'
    expect(readFileSync(TM_DEMO, 'utf8')).toContain(lockFile)
    expect(readFileSync(TM_PROD_REAL, 'utf8')).toContain(lockFile)
  })
})

describe('tm-demo commands', () => {
  it('deploy and status go to tm-prod unchanged', () => {
    const home = makeHome()
    const deploy = run(home, ['deploy', 'abc1234'])
    expect(deploy.status).toBe(0)
    expect(deploy.calls).toEqual(['tm-prod deploy abc1234'])

    const status = run(home, ['-c', 'status'], { STUB_HEALTH: 'healthy' })
    expect(status.status).toBe(0)
    expect(status.stdout).toBe('image: x\nhealth: healthy\n')
    expect(status.calls.at(-1)).toBe('tm-prod status')

    expect(run(home, ['deploy', 'abc1234'], { STUB_EXIT: '3' }).status).toBe(3)
  })

  it('version names both scripts', () => {
    const home = makeHome()
    const hash = createHash('sha256').update(readFileSync(TM_DEMO)).digest('hex').slice(0, 12)
    const r = run(home, ['version'])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe(`tm-demo ${hash} tm-prod prodhash\n`)
  })

  it.each([
    [['reset', 'now']],
    [['-c', 'reset now']],
    [['rm', '-rf', '/']],
    [['-c', 'rm -rf /']],
    [['']],
    [[]],
    [['-c', '']],
    [['-c', 'reset; rm -rf /']],
  ])('refuses %j', (args) => {
    const home = makeHome()
    const r = run(home, args)
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/unknown command|usage/)
    expect(r.calls).toEqual([])
  })

  it('tm-prod has no reset', () => {
    const home = makeHome()
    const r = run(home, ['reset'], {}, TM_PROD_REAL)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain("unknown command 'reset'")
    expect(r.calls).toEqual([])
  })
})

describe('tm-demo reset timer', () => {
  it('the timer resets nightly at 03:00 Prague', () => {
    const lines = (f: string) => readFileSync(resolve('deploy/demo', f), 'utf8').split('\n')
    const timer = lines('tm-demo-reset.timer')
    const service = lines('tm-demo-reset.service')
    expect(timer).toContain('OnCalendar=*-*-* 03:00:00 Europe/Prague')
    expect(timer).toContain('Persistent=false')
    expect(timer).toContain('Unit=tm-demo-reset.service')
    expect(service).toContain('ExecStart=/usr/local/bin/tm-demo reset')
    expect(service).toContain('User=deploy')
    expect(service).toContain('Type=oneshot')
  })
})
