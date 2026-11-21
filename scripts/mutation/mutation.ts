// Mutation testing for PRs (#155): which files Stryker mutates, and the survivor list the
// Tests judge reads. Pure functions; the CLI around them is run.ts.

/** One entry of GitHub's `pulls/<n>/files` listing. */
export interface PrFile {
  filename: string
  status: string
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

const NOT_MUTATED = new Set(['src/routeTree.gen.ts', 'src/server/db/testing.ts'])

/** The added or changed source files of a PR, sorted and unique. Deleted files are left out. */
export function mutateTargets(files: readonly PrFile[]): string[] {
  const targets = new Set<string>()
  for (const { filename, status } of files) {
    if (status === 'removed') continue
    if (!/^src\/.*\.tsx?$/.test(filename)) continue
    if (/\.test\.tsx?$/.test(filename) || NOT_MUTATED.has(filename)) continue
    targets.add(filename)
  }
  return [...targets].sort()
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
