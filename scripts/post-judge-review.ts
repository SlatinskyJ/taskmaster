// Posts one judge round as a single GitHub review (#83), then the judges' thread replies.
// Run by the builder once every judge of the round has written its findings file:
//   node scripts/post-judge-review.ts --dir <folder> --pr <n> --panel Rules,Architecture,Tests
// Posts nothing when a file is missing or bad. Safe to rerun: posted.json records what went out.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  combine,
  commentableLines,
  parseJudgeFile,
  pendingSteps,
  type JudgeFile,
  type Posted,
} from './judge-review/combine.ts'

const REPO = 'repos/SlatinskyJ/taskmaster'

function gh(args: string[]): string {
  return execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

const { values } = parseArgs({
  options: { dir: { type: 'string' }, pr: { type: 'string' }, panel: { type: 'string' } },
})
if (!values.dir || !values.pr || !/^\d+$/.test(values.pr) || !values.panel) {
  console.error(
    'Usage: node scripts/post-judge-review.ts --dir <folder> --pr <n> --panel <Judge,Judge>',
  )
  process.exit(1)
}
const dir = values.dir
const pulls = `${REPO}/pulls/${values.pr}`
const panel = values.panel.split(',').map((j) => j.trim())
const postedPath = join(dir, 'posted.json')

const problems: string[] = []
const files: JudgeFile[] = []
for (const name of readdirSync(dir).sort()) {
  if (!name.endsWith('.json') || name === 'review.json' || name === 'posted.json') continue
  try {
    files.push(parseJudgeFile(name, readFileSync(join(dir, name), 'utf8')))
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e))
  }
}

const headSha = gh([pulls, '--jq', '.head.sha']).trim()
const diff = commentableLines(gh(['-H', 'Accept: application/vnd.github.v3.diff', pulls]))
const combined = combine(files, { panel, headSha, diff })
problems.push(...combined.problems)
if (problems.length > 0) {
  console.error('Nothing posted:')
  for (const p of problems) console.error(`  ✗ ${p}`)
  process.exit(1)
}

const posted: Posted | null = existsSync(postedPath)
  ? (JSON.parse(readFileSync(postedPath, 'utf8')) as Posted)
  : null
const steps = pendingSteps(posted, combined.replies)
const state: Posted = posted ?? { reviewUrl: '', repliesDone: [] }

if (steps.postReview) {
  const reviewPath = join(dir, 'review.json')
  writeFileSync(reviewPath, JSON.stringify(combined.review, null, 2))
  state.reviewUrl = gh([
    '-X',
    'POST',
    `${pulls}/reviews`,
    '--input',
    reviewPath,
    '--jq',
    '.html_url',
  ]).trim()
  writeFileSync(postedPath, JSON.stringify(state, null, 2))
  console.log(`Posted ${state.reviewUrl}`)
} else {
  console.log(`Already posted ${state.reviewUrl}`)
}

for (const reply of steps.replies) {
  gh([
    '-X',
    'POST',
    `${pulls}/comments/${reply.commentId}/replies`,
    '-f',
    `body=${reply.body}`,
    '--jq',
    '.id',
  ])
  // Recorded before the resolve: a rerun must not post the reply twice. A failed resolve
  // shows up in the 0-open-threads check (pr-review-rounds §6).
  state.repliesDone.push(reply.commentId)
  writeFileSync(postedPath, JSON.stringify(state, null, 2))
  if (reply.resolve) gh(['-X', 'POST', `${pulls}/ccr/comments/${reply.commentId}/resolve`])
  console.log(`Replied on ${reply.commentId}${reply.resolve ? ' and resolved it' : ''}`)
}
