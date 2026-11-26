// Mutation testing for PRs (#155): which files Stryker mutates, and the survivor list the
// Tests judge reads. Pure functions; the CLI around them is run.ts.

/** One entry of GitHub's `pulls/<n>/files` listing. */
export interface PrFile {
  filename: string
  status: string
  /** Unified diff of the file. GitHub leaves it out (null after our jq) when the diff is too large. */
  patch?: string | null
}

export type MutantStatus =
  | 'Killed'
  | 'Survived'
  | 'NoCoverage'
  | 'Timeout'
  | 'CompileError'
  | 'RuntimeError'
  | 'Ignored'
  | 'Pending'

interface Position {
  line: number
  column: number
}

export interface StrykerMutant {
  mutatorName: string
  replacement?: string
  status: MutantStatus
  /** 1-based line and column; `end` is exclusive. */
  location: { start: Position; end: Position }
}

/** The part of Stryker's json report (mutation-testing-report-schema) we read. */
export interface StrykerReport {
  files: Record<string, { source: string; mutants: StrykerMutant[] }>
}

const GENERATED = 'src/routeTree.gen.ts'
/** Tests, and test-support modules (`createTestDb()` and friends live in `testing.ts`). */
const TEST_CODE = /(\.test\.tsx?|\/testing\.ts)$/

/**
 * Line ranges (1-based, inclusive) of the new file that a unified diff adds or changes.
 * Touching ranges are joined; lines a hunk only deletes give no range.
 */
export function changedLines(patch: string): [number, number][] {
  const ranges: [number, number][] = []
  let line = 0
  for (const row of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row)
    if (hunk) {
      line = Number(hunk[1])
      continue
    }
    if (row.startsWith('+')) {
      const last = ranges.at(-1)
      if (last && last[1] >= line - 1) last[1] = Math.max(last[1], line)
      else ranges.push([line, line])
      line++
    } else if (row.startsWith(' ')) line++
  }
  return ranges
}

/**
 * What Stryker mutates for a PR: the added or changed lines of its source files, as
 * `file:start-end` (one entry per range), sorted by file then line. A file GitHub sends no
 * patch for (diff too large) is mutated whole. Deleted files and deletion-only edits are left out.
 */
export function mutateTargets(files: readonly PrFile[]): string[] {
  const whole = new Set<string>()
  const ranges = new Map<string, [number, number][]>()
  for (const { filename, status, patch } of files) {
    if (status === 'removed') continue
    if (!/^src\/.*\.tsx?$/.test(filename)) continue
    if (filename === GENERATED || TEST_CODE.test(filename)) continue
    if (patch == null) whole.add(filename)
    else ranges.set(filename, [...(ranges.get(filename) ?? []), ...changedLines(patch)])
  }
  const targets: { file: string; start: number; text: string }[] = []
  for (const file of whole) targets.push({ file, start: 0, text: file })
  for (const [file, list] of ranges) {
    if (whole.has(file)) continue
    for (const [start, end] of list) targets.push({ file, start, text: `${file}:${start}-${end}` })
  }
  targets.sort((a, b) => (a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.start - b.start))
  return [...new Set(targets.map((t) => t.text))]
}

const SNIPPET_MAX = 80

function offset(lineStarts: readonly number[], { line, column }: Position): number {
  return (lineStarts[line - 1] ?? 0) + column - 1
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > SNIPPET_MAX ? `${flat.slice(0, SNIPPET_MAX)}…` : flat
}

/** Survived and NoCoverage mutants as a Markdown list, one `file:line:column` per line. */
export function survivorReport(
  report: StrykerReport,
  maxLines = 200,
): { survived: number; noCoverage: number; total: number; markdown: string } {
  let total = 0
  let survived = 0
  let noCoverage = 0
  const rows: { file: string; line: number; column: number; text: string }[] = []

  for (const [file, { source, mutants }] of Object.entries(report.files)) {
    const lineStarts = [0]
    for (let i = 0; i < source.length; i++) if (source[i] === '\n') lineStarts.push(i + 1)

    for (const m of mutants) {
      total++
      if (m.status !== 'Survived' && m.status !== 'NoCoverage') continue
      if (m.status === 'Survived') survived++
      else noCoverage++
      const { start, end } = m.location
      const original = snippet(source.slice(offset(lineStarts, start), offset(lineStarts, end)))
      const tag = m.status === 'NoCoverage' ? ' (no test)' : ''
      const replacement = snippet(m.replacement ?? '')
      rows.push({
        file,
        line: start.line,
        column: start.column,
        text: `- \`${file}:${start.line}:${start.column}\` ${m.mutatorName}${tag}: \`${original}\` → \`${replacement}\``,
      })
    }
  }

  rows.sort((a, b) =>
    a.file !== b.file ? (a.file < b.file ? -1 : 1) : a.line - b.line || a.column - b.column,
  )

  const lines = [`Mutants: ${total} total, ${survived} survived, ${noCoverage} without a test.`, '']
  if (rows.length === 0) lines.push('No surviving mutants.')
  for (const row of rows.slice(0, maxLines)) lines.push(row.text)
  if (rows.length > maxLines)
    lines.push('', `… and ${rows.length - maxLines} more in mutation.json`)

  return { survived, noCoverage, total, markdown: lines.join('\n') }
}
