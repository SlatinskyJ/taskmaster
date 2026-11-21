import { describe, expect, it } from 'vitest'
import {
  mutateTargets,
  survivorReport,
  type MutantStatus,
  type StrykerMutant,
  type StrykerReport,
} from '../scripts/mutation/mutation.ts'

describe('mutateTargets', () => {
  it('keeps added, modified, renamed, copied and changed src .ts/.tsx files, sorted and unique', () => {
    expect(
      mutateTargets([
        { filename: 'src/b.tsx', status: 'modified' },
        { filename: 'src/lib/testingTools.ts', status: 'modified' },
        { filename: 'src/a.ts', status: 'added' },
        { filename: 'src/c.ts', status: 'renamed' },
        { filename: 'src/d.ts', status: 'copied' },
        { filename: 'src/e.ts', status: 'changed' },
        { filename: 'src/a.ts', status: 'modified' },
      ]),
    ).toEqual([
      'src/a.ts',
      'src/b.tsx',
      'src/c.ts',
      'src/d.ts',
      'src/e.ts',
      'src/lib/testingTools.ts',
    ])
  })

  it('drops removed files, tests, generated and test-support files, and anything outside src/', () => {
    expect(
      mutateTargets([
        { filename: 'src/gone.ts', status: 'removed' },
        { filename: 'src/x.test.ts', status: 'modified' },
        { filename: 'src/x.test.tsx', status: 'modified' },
        { filename: 'src/routeTree.gen.ts', status: 'modified' },
        { filename: 'src/server/db/testing.ts', status: 'modified' },
        { filename: 'src/server/tasks/testing.ts', status: 'added' },
        { filename: 'scripts/a.ts', status: 'modified' },
        { filename: 'tests/a.test.ts', status: 'modified' },
        { filename: 'src/styles/app.css', status: 'modified' },
        { filename: 'docs/src/a.ts', status: 'modified' },
      ]),
    ).toEqual([])
  })
})

function mutant(
  status: MutantStatus,
  mutatorName: string,
  start: [number, number],
  end: [number, number],
  replacement?: string,
): StrykerMutant {
  return {
    mutatorName,
    status,
    ...(replacement === undefined ? {} : { replacement }),
    location: {
      start: { line: start[0], column: start[1] },
      end: { line: end[0], column: end[1] },
    },
  }
}

// Same shape as Stryker 10.1.1's json reporter: line and column 1-based, end exclusive.
const fixture: StrykerReport = {
  files: {
    'src/z.ts': {
      source: 'export const z = () => 1\n',
      mutants: [mutant('Survived', 'ArrowFunction', [1, 18], [1, 25], '() => undefined')],
    },
    'src/a.ts': {
      source: "const a = 1\nif (x > 0) go()\nlog('hi there')\n",
      mutants: [
        mutant('NoCoverage', 'StringLiteral', [3, 5], [3, 15], '""'),
        mutant('Killed', 'ArithmeticOperator', [1, 11], [1, 12], '-1'),
        mutant('Survived', 'ConditionalExpression', [2, 5], [2, 10], 'true'),
        mutant('Timeout', 'BlockStatement', [2, 12], [2, 16], '{}'),
      ],
    },
  },
}

function listLines(markdown: string): string[] {
  return markdown.split('\n').filter((line) => line.startsWith('- '))
}

describe('survivorReport', () => {
  it('lists Survived and NoCoverage mutants as file:line:column, sorted by file then line', () => {
    const r = survivorReport(fixture)
    expect(r).toMatchObject({ survived: 2, noCoverage: 1, total: 5 })
    expect(r.markdown).toContain('Mutants: 5 total, 2 survived, 1 without a test.')
    expect(listLines(r.markdown)).toEqual([
      '- `src/a.ts:2:5` ConditionalExpression: `x > 0` → `true`',
      '- `src/a.ts:3:5` StringLiteral (no test): `\'hi there\'` → `""`',
      '- `src/z.ts:1:18` ArrowFunction: `() => 1` → `() => undefined`',
    ])
    expect(r.markdown).not.toMatch(/Killed|Timeout|Arithmetic|BlockStatement/)
  })

  it('collapses a multi-line original to one line and cuts it at 80 chars with …', () => {
    const long = 'x'.repeat(100)
    const r = survivorReport({
      files: {
        'src/b.ts': {
          source: `function f() {\n  a()\n}\nconst s = '${long}'\n`,
          mutants: [
            mutant('Survived', 'BlockStatement', [1, 14], [3, 2], '{}'),
            mutant('Survived', 'StringLiteral', [4, 11], [4, 113], '""'),
          ],
        },
      },
    })
    expect(listLines(r.markdown)).toEqual([
      '- `src/b.ts:1:14` BlockStatement: `{ a() }` → `{}`',
      `- \`src/b.ts:4:11\` StringLiteral: \`'${'x'.repeat(79)}…\` → \`""\``,
    ])
  })

  it('says so when nothing survived', () => {
    const r = survivorReport({
      files: {
        'src/a.ts': {
          source: 'const a = 1\n',
          mutants: [mutant('Killed', 'ArithmeticOperator', [1, 11], [1, 12], '-1')],
        },
      },
    })
    expect(r).toMatchObject({ survived: 0, noCoverage: 0, total: 1 })
    expect(r.markdown).toContain('No surviving mutants.')
    expect(listLines(r.markdown)).toEqual([])
  })

  it('caps the list at maxLines and says how many were left out', () => {
    const source = Array.from({ length: 250 }, () => 'go()').join('\n')
    const mutants = Array.from({ length: 250 }, (_, i) =>
      mutant('Survived', 'BlockStatement', [i + 1, 1], [i + 1, 5], '{}'),
    )
    const r = survivorReport({ files: { 'src/a.ts': { source, mutants } } }, 200)
    expect(listLines(r.markdown)).toHaveLength(200)
    expect(listLines(r.markdown)[199]).toContain('src/a.ts:200:1')
    expect(r.markdown).toContain('… and 50 more in mutation.json')
  })

  it('caps at 200 lines by default', () => {
    const source = Array.from({ length: 201 }, () => 'go()').join('\n')
    const mutants = Array.from({ length: 201 }, (_, i) =>
      mutant('NoCoverage', 'BlockStatement', [i + 1, 1], [i + 1, 5], '{}'),
    )
    const r = survivorReport({ files: { 'src/a.ts': { source, mutants } } })
    expect(listLines(r.markdown)).toHaveLength(200)
    expect(r.markdown).toContain('… and 1 more in mutation.json')
  })
})
