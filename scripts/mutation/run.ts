// CI job `mutation` (#155): runs Stryker on the src/ files a PR changes and prints the
// surviving mutants for the Tests judge. Usage: node scripts/mutation/run.ts <pr-files.json>
// (a JSON array of GitHub `pulls/<n>/files` entries). Survivors never fail the run; a Stryker
// run that fails, is killed or writes no report does.
//
// stryker.config.json keeps `ignoreStatic` off (#189). A static mutant (module-level code, e.g.
// a const list) runs when a file is imported. When one test imports the module inside its body
// (a dynamic `import()`), Stryker sees that test cover the mutant too and, with `ignoreStatic`
// on, runs only that test: the test files that pin the value imported it before their tests
// started, so they never ran, and the mutant was listed as a survivor. With it off, a static
// mutant reloads the modules and runs every related test: slower, but its result is real.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { mutateTargets, survivorReport, type PrFile, type StrykerReport } from './mutation.ts'

const REPORT = 'reports/mutation/mutation.json'
const SURVIVORS = 'reports/mutation/survivors.md'

export interface RunDeps {
  /** Runs `stryker run <args>`; returns its exit status (null when killed by a signal). */
  spawn: (args: string[]) => { status: number | null }
  /** The file's text, or undefined when it does not exist. */
  readFile: (path: string) => string | undefined
  writeFile: (path: string, text: string) => void
  appendFile: (path: string, text: string) => void
  log: (line: string) => void
  env: Record<string, string | undefined>
}

export function main(prFiles: readonly PrFile[], deps: RunDeps): number {
  const targets = mutateTargets(prFiles)
  if (targets.length === 0) {
    deps.log('No src/ files to mutate.')
    return 0
  }

  const { status } = deps.spawn(['--mutate', targets.join(',')])
  if (status === null) {
    deps.log('Stryker was killed before it finished.')
    return 1
  }
  if (status !== 0) return status

  const json = deps.readFile(REPORT)
  if (json === undefined) {
    deps.log('Stryker finished but wrote no report.')
    return 1
  }

  const { markdown } = survivorReport(JSON.parse(json) as StrykerReport)
  deps.writeFile(SURVIVORS, `${markdown}\n`)
  deps.log('=== mutation report ===')
  deps.log(markdown)
  deps.log('=== end mutation report ===')
  const summary = deps.env.GITHUB_STEP_SUMMARY
  if (summary) deps.appendFile(summary, `## Mutation testing\n\n${markdown}\n`)
  return 0
}

if (import.meta.main) {
  const [filesPath] = process.argv.slice(2)
  if (!filesPath) {
    console.error('Usage: node scripts/mutation/run.ts <pr-files.json>')
    process.exit(2)
  }
  const prFiles = JSON.parse(readFileSync(filesPath, 'utf8')) as PrFile[]
  process.exitCode = main(prFiles, {
    spawn: (args) => spawnSync('pnpm', ['exec', 'stryker', 'run', ...args], { stdio: 'inherit' }),
    readFile: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined),
    writeFile: (path, text) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
    },
    appendFile: (path, text) => {
      appendFileSync(path, text)
    },
    log: (line) => {
      console.log(line)
    },
    env: process.env,
  })
}
