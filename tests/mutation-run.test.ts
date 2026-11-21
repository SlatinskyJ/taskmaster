import { describe, expect, it } from 'vitest'
import type { PrFile, StrykerReport } from '../scripts/mutation/mutation.ts'
import { main, type RunDeps } from '../scripts/mutation/run.ts'

const REPORT = 'reports/mutation/mutation.json'
const SURVIVORS = 'reports/mutation/survivors.md'

const report: StrykerReport = {
  files: {
    'src/a.ts': {
      source: 'if (x > 0) go()\n',
      mutants: [
        {
          mutatorName: 'ConditionalExpression',
          replacement: 'true',
          status: 'Survived',
          location: { start: { line: 1, column: 5 }, end: { line: 1, column: 10 } },
        },
      ],
    },
  },
}

function fakeDeps(opts: {
  status?: number | null
  writesReport?: boolean
  env?: Record<string, string | undefined>
}) {
  const calls = {
    spawn: [] as string[][],
    logs: [] as string[],
    written: new Map<string, string>(),
    appended: new Map<string, string>(),
  }
  const files = new Map<string, string>()
  const deps: RunDeps = {
    spawn: (args) => {
      calls.spawn.push(args)
      if (opts.writesReport) files.set(REPORT, JSON.stringify(report))
      return { status: opts.status === undefined ? 0 : opts.status }
    },
    readFile: (path) => files.get(path),
    writeFile: (path, text) => calls.written.set(path, text),
    appendFile: (path, text) => calls.appended.set(path, (calls.appended.get(path) ?? '') + text),
    log: (line) => calls.logs.push(line),
    env: opts.env ?? {},
  }
  return { deps, calls }
}

const changed: PrFile[] = [
  { filename: 'src/b.ts', status: 'modified' },
  { filename: 'src/a.ts', status: 'added' },
]

describe('mutation run main', () => {
  it('no targets: Stryker is not started, logs "No src/ files to mutate.", returns 0', () => {
    const { deps, calls } = fakeDeps({})
    const code = main(
      [
        { filename: 'src/routeTree.gen.ts', status: 'modified' },
        { filename: 'src/a.test.ts', status: 'modified' },
      ],
      deps,
    )
    expect(code).toBe(0)
    expect(calls.spawn).toEqual([])
    expect(calls.logs).toEqual(['No src/ files to mutate.'])
  })

  it('passes the targets to Stryker as one --mutate argument', () => {
    const { deps, calls } = fakeDeps({ writesReport: true })
    main(changed, deps)
    expect(calls.spawn).toEqual([['--mutate', 'src/a.ts,src/b.ts']])
  })

  it('Stryker status 1 → returns 1', () => {
    const { deps } = fakeDeps({ status: 1, writesReport: true })
    expect(main(changed, deps)).toBe(1)
  })

  it('passes any other Stryker failure status through (2 → 2)', () => {
    const { deps } = fakeDeps({ status: 2, writesReport: true })
    expect(main(changed, deps)).toBe(2)
  })

  it('Stryker status null (killed) → returns 1', () => {
    const { deps } = fakeDeps({ status: null })
    expect(main(changed, deps)).toBe(1)
  })

  it('status 0 but no mutation.json → returns 1 and logs "Stryker finished but wrote no report."', () => {
    const { deps, calls } = fakeDeps({ status: 0, writesReport: false })
    expect(main(changed, deps)).toBe(1)
    expect(calls.logs).toContain('Stryker finished but wrote no report.')
    expect(calls.written.size).toBe(0)
  })

  it('status 0 with a report: prints the markers around the list, writes survivors.md, appends to the job summary', () => {
    const { deps, calls } = fakeDeps({
      writesReport: true,
      env: { GITHUB_STEP_SUMMARY: '/tmp/summary.md' },
    })
    expect(main(changed, deps)).toBe(0)
    const out = calls.logs.join('\n')
    expect(out).toMatch(
      /=== mutation report ===\n[\s\S]*- `src\/a\.ts:1:5` ConditionalExpression: `x > 0` → `true`[\s\S]*\n=== end mutation report ===/,
    )
    expect(calls.written.get(SURVIVORS)).toContain('- `src/a.ts:1:5` ConditionalExpression')
    expect(calls.appended.get('/tmp/summary.md')).toContain('Mutants: 1 total, 1 survived')
  })

  it('does not touch a job summary when GITHUB_STEP_SUMMARY is unset', () => {
    const { deps, calls } = fakeDeps({ writesReport: true })
    expect(main(changed, deps)).toBe(0)
    expect(calls.appended.size).toBe(0)
  })
})
