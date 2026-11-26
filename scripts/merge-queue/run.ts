// The merge-me Action's entry point (#253): one step per event. The workflow
// (.github/workflows/merge-queue.yml) runs it as `node scripts/merge-queue/run.ts`.
// No retry loops: the next event (label, CI done, push to main) runs it again.
import { pathToFileURL } from 'node:url'
import { nextActions, type PrFacts } from './decide.ts'
import { FOOTER, LABEL, approvedMarker, handoffMarker, makeGh, type Gh } from './github.ts'

function approvalBody(key: string, pr: number, labelEventId: number, sha: string): string {
  return `${approvedMarker(key, pr, labelEventId, sha)}\nThe merge-me Action recorded \`merge-me\` on commit ${sha}. It lands this PR on that commit only, after updating it with \`main\` if needed.\n\n${FOOTER}`
}

function handOverBody(key: string, pr: PrFacts, reason: string): string {
  return `${handoffMarker(key, pr.number, pr.labelEventId)}\nThe merge-me Action hands this PR over: ${reason}.\n\nRun skill merge-approved-prs for this PR.\n\n${FOOTER}`
}

type Log = (line: string) => void

// Records Jakub's approval for the labelled commit. The workflow runs this in its own job, one
// lane per PR, so labelling many PRs at once never drops an approval (the shared queue below
// keeps only one waiting run).
export async function record(
  gh: Gh,
  log: Log,
  markerKey: string,
  labelEvent: { pr: number; sha: string },
): Promise<void> {
  const { pr, sha } = labelEvent
  const labelId = await gh.latestLabelEventId(pr)
  if (labelId === null) log(`merge-queue: #${pr} has no merge-me label by SlatinskyJ`)
  else {
    await gh.comment(pr, approvalBody(markerKey, pr, labelId, sha))
    log(`merge-queue: #${pr} approved on ${sha}`)
  }
}

export async function run(
  gh: Gh,
  log: Log,
  markerKey: string,
  labelEvent?: { pr: number; sha: string },
): Promise<{ handedOver: number[] }> {
  if (labelEvent) await record(gh, log, markerKey, labelEvent)
  return step(gh, log, markerKey)
}

// One queue step over every labelled PR: hand over, update, merge or wait.
export async function step(gh: Gh, log: Log, markerKey: string): Promise<{ handedOver: number[] }> {
  const handedOver: number[] = []
  const prs = await gh.labelledPrs()
  const byNumber = new Map<number, PrFacts>(prs.map((p) => [p.number, p]))
  const factsOf = (pr: number): PrFacts => {
    const f = byNumber.get(pr)
    if (!f) throw new Error(`no facts for #${pr}`)
    return f
  }
  const handOver = async (pr: number, reason: string) => {
    await gh.comment(pr, handOverBody(markerKey, factsOf(pr), reason))
    log(`merge-queue: #${pr} handed over: ${reason}`)
    handedOver.push(pr)
  }
  for (const action of nextActions(prs)) {
    switch (action.kind) {
      case 'hand-over':
        await handOver(action.pr, action.reason)
        break
      case 'update': {
        if ((await gh.updateBranch(action.pr, factsOf(action.pr).headSha)) === 'conflict') {
          await handOver(action.pr, 'update with main has a conflict')
        } else log(`merge-queue: #${action.pr} updated with main`)
        break
      }
      case 'merge':
        if ((await gh.merge(action.pr, action.sha)) === 'merged') {
          await gh.removeLabel(action.pr, LABEL)
          log(`merge-queue: #${action.pr} merged on ${action.sha}`)
        } else
          await handOver(action.pr, 'merge refused (the head moved, or the ruleset blocked it)')
        break
      case 'wait':
        log(`merge-queue: #${action.pr} waiting for CI`)
        break
      case 'idle':
        log('merge-queue: nothing to do')
        break
    }
  }
  return { handedOver }
}

// What the workflow's two jobs run: with a label event (job record) only record; otherwise (job
// queue) one queue step.
export async function entry(
  gh: Gh,
  log: Log,
  markerKey: string,
  env: NodeJS.ProcessEnv,
): Promise<{ handedOver: number[] }> {
  const labelEvent = labelEventFromEnv(env)
  if (!labelEvent) return step(gh, log, markerKey)
  await record(gh, log, markerKey, labelEvent)
  return { handedOver: [] }
}

function labelEventFromEnv(env: NodeJS.ProcessEnv): { pr: number; sha: string } | undefined {
  const pr = env.LABEL_PR ?? ''
  const sha = env.LABEL_SHA ?? ''
  if (pr === '' && sha === '') return undefined
  if (!/^\d+$/.test(pr) || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`bad LABEL_PR or LABEL_SHA: ${JSON.stringify({ pr, sha })}`)
  }
  return { pr: Number(pr), sha }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const token = process.env.GH_TOKEN
  const key = process.env.MERGE_MARKER_KEY
  if (!token || !key) {
    console.error('merge-queue: GH_TOKEN and MERGE_MARKER_KEY are required')
    process.exit(1)
  }
  const gh = makeGh(token, key, fetch, { repo: process.env.GITHUB_REPOSITORY })
  const log: Log = (line) => {
    console.log(line)
  }
  const { handedOver } = await entry(gh, log, key, process.env)
  // The hand-over comment is posted as Jakub (PAT), so GitHub notifies nobody. A red run does:
  // GitHub mails the failed-run notice, and the annotation names the PRs.
  if (handedOver.length > 0) {
    console.log(
      `::error::merge-queue handed over ${handedOver.map((n) => `#${n}`).join(', ')}: run skill merge-approved-prs`,
    )
    process.exitCode = 1
  }
}
