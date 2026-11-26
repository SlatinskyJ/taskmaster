// Decides which merge-me PR the merge-me Action acts on, and how (#253).
// Pure: the facts come from github.ts, so every decision is unit-tested.

export type Ci = 'green' | 'pending' | 'red'

export interface PrFacts {
  number: number
  draft: boolean
  /** Head branch lives outside this repository (a fork, or a deleted head repo). */
  fromFork: boolean
  /** The PR targets main (a PR on another branch is a stack, linked or not). */
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
  inStack: boolean
  behind: boolean
  /** A hand-over marker signed for the latest qualifying label exists. */
  handedOver: boolean
}

export type Action =
  | { kind: 'update'; pr: number }
  | { kind: 'merge'; pr: number; sha: string }
  | { kind: 'hand-over'; pr: number; reason: string }
  | { kind: 'wait'; pr: number }
  | { kind: 'idle' }

/** How long a label may wait for its own run to record the approval. */
export const RECORD_GRACE_MINUTES = 15
export const NOT_RECORDED = 'approval not recorded: add merge-me again'

export function entryCheck(pr: PrFacts): { ok: true } | { ok: false; reason: string } {
  if (pr.draft) return { ok: false, reason: 'draft' }
  if (pr.fromFork) return { ok: false, reason: 'PR from a fork' }
  if (!pr.baseIsMain) return { ok: false, reason: 'base is not main' }
  if (pr.needsJakubAfterLabel) return { ok: false, reason: 'open question (needs-jakub)' }
  if (!pr.headIsApproved) return { ok: false, reason: 'new commits after the label' }
  if (pr.ci === 'red') return { ok: false, reason: 'CI red' }
  if (pr.unresolvedThreads > 0) {
    const n = pr.unresolvedThreads
    return { ok: false, reason: `${n} unresolved thread${n === 1 ? '' : 's'}` }
  }
  if (pr.inStack) return { ok: false, reason: 'in a GitHub stack' }
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
  const active = passing.find((pr) => pr.updatedByAction) ?? passing[0]
  if (active) {
    if (active.behind) actions.push({ kind: 'update', pr: active.number })
    else if (active.ci === 'green') {
      actions.push({ kind: 'merge', pr: active.number, sha: active.headSha })
    } else actions.push({ kind: 'wait', pr: active.number })
  }
  return actions.length > 0 ? actions : [{ kind: 'idle' }]
}
