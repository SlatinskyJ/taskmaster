// Decides which merge-me PR the merge-me Action acts on, and how (#253).
// Pure: the facts come from github.ts, so every decision is unit-tested.

export type Ci = 'green' | 'pending' | 'red'

export interface PrFacts {
  number: number
  draft: boolean
  /** Head branch lives outside this repository (a fork, or a deleted head repo). */
  fromFork: boolean
  /** The PR targets main. A PR on another branch sits on a lower PR and waits for it to merge. */
  baseIsMain: boolean
  /** From the Action's HMAC-signed approval marker after the latest qualifying label; null = not recorded. */
  approvedSha: string | null
  /** Id of the latest qualifying merge-me label event; signs this PR's hand-over marker. */
  labelEventId: number
  headSha: string
  /** Head is the approved SHA, or accepted update merges the Action made on top of it. */
  headIsApproved: boolean
  /** Head is not the approved SHA but an accepted update merge on top of it. */
  updatedByAction: boolean
  /** Minutes since the latest qualifying merge-me label. */
  labelAgeMinutes: number
  needsJakubAfterLabel: boolean
  ci: Ci
  unresolvedThreads: number
  /** The open GitHub stack this PR is in, with the stack's open PRs; null when not stacked. */
  stack: { number: number; openPrs: number[] } | null
  behind: boolean
  /**
   * When labelled on a lower PR: 'ok' = it contained that PR's head and that PR merged on it;
   * 'pending' = that PR is still open on that head; 'bad' = anything else. 'none' = labelled on main.
   */
  lower: 'none' | 'ok' | 'pending' | 'bad'
  /** A hand-over marker signed for the latest qualifying label exists. */
  handedOver: boolean
}

export type Action =
  | { kind: 'update'; pr: number }
  | { kind: 'merge'; pr: number; sha: string }
  | { kind: 'hand-over'; pr: number; reason: string }
  | { kind: 'wait'; pr: number; for: string }
  | { kind: 'unstack'; stack: number; prs: number[] }
  | { kind: 'idle' }

/** How long a label may wait for its own run to record the approval. */
export const RECORD_GRACE_MINUTES = 15
export const NOT_RECORDED = 'approval not recorded: add merge-me again'

export function entryCheck(pr: PrFacts): { ok: true } | { ok: false; reason: string } {
  if (pr.draft) return { ok: false, reason: 'draft' }
  if (pr.fromFork) return { ok: false, reason: 'PR from a fork' }
  if (pr.needsJakubAfterLabel) return { ok: false, reason: 'open question (needs-jakub)' }
  if (!pr.headIsApproved) return { ok: false, reason: 'new commits after the label' }
  if (pr.lower === 'bad') {
    return {
      ok: false,
      reason: 'its lower PR changed after the label, or it was not up to date with it',
    }
  }
  if (pr.ci === 'red') return { ok: false, reason: 'CI red' }
  if (pr.unresolvedThreads > 0) {
    const n = pr.unresolvedThreads
    return { ok: false, reason: `${n} unresolved thread${n === 1 ? '' : 's'}` }
  }
  return { ok: true }
}

export function nextActions(prs: PrFacts[]): Action[] {
  const actions: Action[] = []
  const passing: PrFacts[] = []
  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    if (pr.handedOver) continue
    if (pr.approvedSha === null) {
      if (pr.labelAgeMinutes >= RECORD_GRACE_MINUTES) {
        actions.push({ kind: 'hand-over', pr: pr.number, reason: NOT_RECORDED })
      }
      continue
    }
    const check = entryCheck(pr)
    if (check.ok) passing.push(pr)
    else actions.push({ kind: 'hand-over', pr: pr.number, reason: check.reason })
  }
  // Stacks: GitHub refuses update and merge on a stacked PR. Once every open PR of a stack is
  // labelled and passes, take them out of the stack; bases stay, so they still land bottom-up
  // (GitHub retargets the next PR to main when the lower one merges and its branch is deleted).
  // Until then, and while a PR sits on a lower PR's branch, it waits without a hand-over.
  const ready = new Set(passing.map((pr) => pr.number))
  const unstacked = new Set<number>()
  for (const pr of passing) {
    const s = pr.stack
    if (!s || unstacked.has(s.number)) continue
    if (s.openPrs.every((n) => ready.has(n))) {
      actions.push({ kind: 'unstack', stack: s.number, prs: s.openPrs })
      unstacked.add(s.number)
    }
  }
  const landable = passing.filter((pr) => pr.baseIsMain && !pr.stack && pr.lower !== 'pending')
  for (const pr of passing) {
    if (!landable.includes(pr) && !(pr.stack && unstacked.has(pr.stack.number))) {
      actions.push({
        kind: 'wait',
        pr: pr.number,
        for: pr.stack ? 'its whole stack' : 'its lower PR to merge',
      })
    }
  }
  const active = landable.find((pr) => pr.updatedByAction) ?? landable[0]
  if (active) {
    if (active.behind) actions.push({ kind: 'update', pr: active.number })
    else if (active.ci === 'green') {
      actions.push({ kind: 'merge', pr: active.number, sha: active.headSha })
    } else actions.push({ kind: 'wait', pr: active.number, for: 'CI' })
  }
  return actions.length > 0 ? actions : [{ kind: 'idle' }]
}
