// Which CI jobs a PR needs (#78, #349), from its changed file names (new and old names).
// `code`: some file is not docs, so typecheck, lint, format, migrations, test and mutation run.
// `app`: some file is neither docs nor tooling, so build and image run too.
// Fail closed: an empty list runs everything. CLI: names on stdin, `code=` and `app=` lines on
// stdout for $GITHUB_OUTPUT, the reason on stderr.
import { readFileSync } from 'node:fs'

/** Markdown that no check reads (all Prettier-ignored; ESLint and tsc skip .md). */
const DOCS = /^((docs|\.claude)\/.*\.md|[^/]+\.md|\.github\/[^/]+\.md)$/
/** Repo tooling: the app cannot import it, so build and image cannot break by it. */
const TOOLING =
  /^(scripts\/.+|tests\/(judge-review|merge-queue|mutation|red-main)(-[^/]*)?\.test\.ts|\.claude\/.+|\.github\/workflows\/[^/]+\.yml)$/
/**
 * Tooling that still runs everything: the workflows that define or deploy the build and image,
 * and this classifier with its test (the `changes` job runs the PR's own copy of it).
 */
const RUNS_ALL =
  /^(\.github\/workflows\/(ci|preview[^/]*)\.yml|scripts\/ci\/.+|tests\/ci-[^/]*\.test\.ts)$/

export interface Scope {
  code: boolean
  app: boolean
}

export function classify(files: readonly string[]): Scope {
  if (files.length === 0) return { code: true, app: true }
  const code = files.some((f) => !DOCS.test(f))
  const app = files.some((f) => RUNS_ALL.test(f) || !(DOCS.test(f) || TOOLING.test(f)))
  return { code, app }
}

if (import.meta.main) {
  const files = readFileSync(0, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  const { code, app } = classify(files)
  process.stdout.write(`code=${String(code)}\napp=${String(app)}\n`)
  const reason = !code
    ? 'No code changed: skipping checks.'
    : !app
      ? 'No app files changed: skipping build and image.'
      : 'App files changed: running everything.'
  process.stderr.write(`${reason}\n`)
}
