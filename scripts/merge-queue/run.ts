// The merge-me Action's entry point (#253): one step per event. The workflow
// (.github/workflows/merge-queue.yml) runs it as `node scripts/merge-queue/run.ts`.
// No retry loops: the next event (label, CI done, push to main) runs it again.
import { pathToFileURL } from 'node:url'
import { alertHandback } from './alert.ts'
import {
  MAX_REARMS,
  handOver as handOverAction,
  nextActions,
  type HandOver,
  type HandoverKind,
  type PrFacts,
} from './decide.ts'
import {
  FOOTER,
  LABEL,
  approvedMarker,
  handoffMarker,
  makeGh,
  resumedMarker,
  type Gh,
  type Lower,
} from './github.ts'

function approvalBody(
  key: string,
  pr: number,
  labelEventId: number,
  sha: string,
  lower: Lower | null,
): string {
  return `${approvedMarker(key, pr, labelEventId, sha, lower)}\nThe merge-me Action recorded \`merge-me\` on commit ${sha}. It lands this PR on that commit only, after updating it with \`main\` if needed.\n\n${FOOTER}`
}

const NEXT: Record<HandoverKind, string> = {
  ci: `The Action takes this PR back into the queue by itself once a newer head is green, at most ${MAX_REARMS} times under this label. If the red test is one this PR adds or changes, the owner thread adds \`needs-jakub\` instead.`,
  fix: 'Fix it within skill merge-approved-prs section 3, push, then post a comment `<!-- merge-queue:rearm <head sha> -->` (the full SHA of the pushed head): the Action then takes this PR back into the queue.',
  final: 'This needs Jakub: the Action takes this PR back only when he adds `merge-me` again.',
}

function handOverBody(
  key: string,
  pr: PrFacts,
  reason: string,
  as: HandoverKind,
  n: number,
  redSha: string | null,
): string {
  return `${handoffMarker(key, pr.number, pr.labelEventId, as, n, redSha)}\nThe merge-me Action hands this PR over: ${reason}.\n\n${NEXT[as]}\n\nRun skill merge-approved-prs for this PR.\n\n${FOOTER}`
}

function resumedBody(key: string, pr: PrFacts, n: number, sha: string): string {
  return `${resumedMarker(key, pr.number, pr.labelEventId, n, sha)}\nThe merge-me Action takes this PR back into the queue on commit ${sha} (re-arm ${n} of ${MAX_REARMS} under this label).\n\n${FOOTER}`
}

type Log = (line: string) => void
/** A label event: the PR, its head, and its base branch with that branch's tip. */
export interface LabelEvent {
  pr: number
  sha: string
  base: { ref: string; sha: string }
}

// Records Jakub's approval for the labelled commit. The workflow runs this in its own job, one
// lane per PR, so labelling many PRs at once never drops an approval (the shared queue below
// keeps only one waiting run).
export async function record(
  gh: Gh,
  log: Log,
  markerKey: string,
  labelEvent: LabelEvent,
): Promise<void> {
  const { pr, sha, base } = labelEvent
  const labelId = await gh.latestLabelEventId(pr)
  if (labelId === null) log(`merge-queue: #${pr} has no merge-me label by SlatinskyJ`)
  else {
    // On a lower PR: record which PR and its head, so this PR lands only after that PR merged
    // on that head (plus GitHub's own update merges). No open PR on the branch: pr 0, never lands.
    const lower: Lower | null =
      base.ref === 'main' ? null : { pr: (await gh.openPrWithHead(base.ref)) ?? 0, sha: base.sha }
    await gh.comment(pr, approvalBody(markerKey, pr, labelId, sha, lower))
    log(`merge-queue: #${pr} approved on ${sha}`)
  }
}

export async function run(
  gh: Gh,
  log: Log,
  markerKey: string,
  labelEvent?: LabelEvent,
): Promise<{ handedOver: number[] }> {
  if (labelEvent) await record(gh, log, markerKey, labelEvent)
  return step(gh, log, markerKey)
}

// One queue step over every labelled PR: hand over, update, merge or wait.
// After taking a stack apart it reads the PRs again, so the bottom PR can move in the same run.
export async function step(gh: Gh, log: Log, markerKey: string): Promise<{ handedOver: number[] }> {
  const handedOver: number[] = []
  if (await pass(gh, log, markerKey, handedOver, true)) {
    await pass(gh, log, markerKey, handedOver, false)
  }
  return { handedOver }
}

/** Returns true when it unstacked (and then skipped updates and merges, which need fresh facts). */
async function pass(
  gh: Gh,
  log: Log,
  markerKey: string,
  handedOver: number[],
  mayUnstack: boolean,
): Promise<boolean> {
  const prs = await gh.labelledPrs()
  const byNumber = new Map<number, PrFacts>(prs.map((p) => [p.number, p]))
  const factsOf = (pr: number): PrFacts => {
    const f = byNumber.get(pr)
    if (!f) throw new Error(`no facts for #${pr}`)
    return f
  }
  const handOver = async (a: HandOver) => {
    await gh.comment(a.pr, handOverBody(markerKey, factsOf(a.pr), a.reason, a.as, a.n, a.redSha))
    log(`merge-queue: #${a.pr} handed over (${a.as} ${a.n}): ${a.reason}`)
    handedOver.push(a.pr)
  }
  const actions = nextActions(prs)
  const unstacking = mayUnstack && actions.some((a) => a.kind === 'unstack')
  for (const action of actions) {
    if (unstacking && (action.kind === 'update' || action.kind === 'merge')) continue
    switch (action.kind) {
      case 'unstack':
        if (!mayUnstack) break
        await gh.unstack(action.stack, action.prs)
        log(
          `merge-queue: stack ${action.stack} taken apart (${action.prs.map((n) => `#${n}`).join(', ')})`,
        )
        break
      case 'hand-over':
        await handOver(action)
        break
      case 'resume': {
        const f = factsOf(action.pr)
        await gh.comment(action.pr, resumedBody(markerKey, f, action.n, action.sha))
        // Its next problem is a new hand-over counted from this re-arm.
        byNumber.set(action.pr, { ...f, handover: null, rearms: action.n })
        log(`merge-queue: #${action.pr} re-armed (${action.n}) on ${action.sha}`)
        break
      }
      case 'update': {
        if ((await gh.updateBranch(action.pr, factsOf(action.pr).headSha)) === 'conflict') {
          await handOver(
            handOverAction(factsOf(action.pr), 'conflict', 'update with main has a conflict'),
          )
        } else log(`merge-queue: #${action.pr} updated with main`)
        break
      }
      case 'merge':
        if ((await gh.merge(action.pr, action.sha)) === 'merged') {
          await gh.removeLabel(action.pr, LABEL)
          log(`merge-queue: #${action.pr} merged on ${action.sha}`)
        } else
          await handOver(
            handOverAction(
              factsOf(action.pr),
              'merge-refused',
              'merge refused (the head moved, or the ruleset blocked it)',
            ),
          )
        break
      case 'wait':
        log(`merge-queue: #${action.pr} waiting for ${action.for}`)
        break
      case 'idle':
        log('merge-queue: nothing to do')
        break
    }
  }
  return unstacking
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

function labelEventFromEnv(env: NodeJS.ProcessEnv): LabelEvent | undefined {
  const pr = env.LABEL_PR ?? ''
  const sha = env.LABEL_SHA ?? ''
  const baseRef = env.LABEL_BASE_REF ?? ''
  const baseSha = env.LABEL_BASE_SHA ?? ''
  if (pr === '' && sha === '') return undefined
  const isSha = (v: string) => /^[0-9a-f]{40}$/.test(v)
  if (!/^\d+$/.test(pr) || !isSha(sha) || baseRef === '' || !isSha(baseSha)) {
    throw new Error(
      `bad LABEL_PR, LABEL_SHA, LABEL_BASE_REF or LABEL_BASE_SHA: ${JSON.stringify({ pr, sha, baseRef, baseSha })}`,
    )
  }
  return { pr: Number(pr), sha, base: { ref: baseRef, sha: baseSha } }
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
  // Wakes the coordinator through a Claude scheduled task (alert.ts); a failed alert only warns.
  const testAlert = process.env.HANDBACK_TEST_ALERT === 'true'
  const alert = await alertHandback(fetch, process.env, handedOver, testAlert)
  if (alert.result === 'sent')
    console.log(`merge-queue: hand-over alert sent${testAlert ? ' (test)' : ''}`)
  else if (alert.result === 'failed')
    console.log(`::warning::merge-queue: hand-over alert failed (${alert.detail})`)
  else if (alert.result === 'bad-url')
    console.log('::warning::merge-queue: hand-over alert bad-url')
}
