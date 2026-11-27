import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { classify } from '../scripts/ci/changes.ts'

const TOOLING = 'scripts/merge-queue/run.ts'

describe('classify', () => {
  it('runs everything when the file list is empty (fail closed)', () => {
    expect(classify([])).toEqual({ code: true, app: true })
  })

  it.each([
    'README.md',
    'docs/x.md',
    '.claude/skills/a/SKILL.md',
    '.github/pull_request_template.md',
  ])('skips everything for docs only: %s', (file) => {
    expect(classify([file])).toEqual({ code: false, app: false })
  })

  it('skips only the app jobs for the files of #346', () => {
    const files = [
      'scripts/merge-queue/run.ts',
      'scripts/merge-queue/decide.ts',
      'tests/merge-queue-run.test.ts',
      'tests/merge-queue-decide.test.ts',
      '.claude/skills/merge-approved-prs/SKILL.md',
      'CLAUDE.md',
      '.github/workflows/merge-queue.yml',
    ]
    expect(classify(files)).toEqual({ code: true, app: false })
  })

  it.each([
    'scripts/a.ts',
    'scripts/merge-queue/run.ts',
    'tests/red-main-run.test.ts',
    'tests/mutation.test.ts',
    'tests/mutation-run.test.ts',
    'tests/judge-review-combine.test.ts',
    '.claude/settings.json',
    '.github/workflows/red-main.yml',
    '.github/workflows/merge-queue.yml',
  ])('counts %s as tooling', (file) => {
    expect(classify([file])).toEqual({ code: true, app: false })
  })

  it.each([
    'src/x.ts',
    'tests/screen-guards.test.ts',
    'tests/support/passkeys.ts',
    'tests/merge-queuex/a.ts',
    '.github/workflows/ci.yml',
    '.github/workflows/preview.yml',
    '.github/workflows/preview-host.yml',
    '.github/workflows/preview-cleanup.yml',
    'scripts/ci/changes.ts',
    'tests/ci-changes.test.ts',
    'tests/city-map.test.ts',
    '.github/dependabot.yml',
    'package.json',
    'pnpm-lock.yaml',
    'Dockerfile',
    'e2e/a.spec.ts',
    'docs/x.ts',
    'xscripts/a.ts',
  ])('runs the app jobs for %s, alone and mixed with tooling', (file) => {
    expect(classify([file]).app).toBe(true)
    expect(classify([TOOLING, file]).app).toBe(true)
    expect(classify([file, TOOLING]).app).toBe(true)
  })
})

function cli(stdin: string) {
  const r = spawnSync(process.execPath, ['scripts/ci/changes.ts'], {
    input: stdin,
    encoding: 'utf8',
  })
  expect(r.status).toBe(0)
  return r.stdout.split('\n').filter((l) => /^(code|app)=/.test(l))
}

describe('changes CLI', () => {
  it('prints app=false for a tooling-only list that ends in a newline', () => {
    expect(cli('scripts/a.ts\ntests/red-main-run.test.ts\nCLAUDE.md\n')).toEqual([
      'code=true',
      'app=false',
    ])
  })

  it('runs everything on empty stdin', () => {
    expect(cli('')).toEqual(['code=true', 'app=true'])
  })

  it('prints app=true for an app list', () => {
    expect(cli('scripts/a.ts\nsrc/x.ts\n')).toEqual(['code=true', 'app=true'])
  })

  it('prints code=false app=false for docs only', () => {
    expect(cli('README.md\n')).toEqual(['code=false', 'app=false'])
  })
})
