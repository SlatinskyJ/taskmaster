// Decides which merge-me PR the merge-me Action acts on, and how (#253).
// Pure: the facts come from github.ts, so every decision is unit-tested.

export type Ci = 'green' | 'pending' | 'red'
/** What a handed-over PR may do next: ci = parked until a newer head is green; fix = back on the owner thread's re-arm request; final = only a new label. */
export type HandoverKind = 'ci' | 'fix' | 'final'

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
  /**
   * Head is the baseline (the approved SHA, or the SHA of the latest re-arm), or accepted
   * update merges the Action made on top of it.
   */
  headIsApproved: boolean
  /** Head is not the baseline but an accepted update merge on top of it. */
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
  /**
   * The open hand-over under the latest qualifying label: its signed marker with n > rearms.
   * An old-format marker (before #344) is { kind: 'final', n: Infinity, redSha: null }.
   */
  handover: { kind: HandoverKind; n: number; redSha: string | null } | null
  /** Highest n among this label's signed resumed markers; 0 if none. */
  rearms: number
  /** Head SHA named by SlatinskyJ's latest re-arm request after the open hand-over. */
  rearmRequest: string | null
  /**
   * Every commit after the baseline is a merge of main or a `merge-approved-prs: ` commit
   * (the fixes skill merge-approved-prs allows), so a re-arm request may put the head back.
   */
  headIsFixed: boolean
}

export type Action =
  | { kind: 'update'; pr: number }
  | { kind: 'merge'; pr: number; sha: string }
  | {
      kind: 'hand-over'
      pr: number
      reason: string
      as: HandoverKind
      n: number
      redSha: string | null
    }
  | { kind: 'resume'; pr: number; n: number; sha: string }
  | { kind: 'wait'; pr: number; for: string }
  | { kind: 'unstack'; stack: number; prs: number[] }
  | { kind: 'idle' }

/** How long a label may wait for its own run to record the approval. */
export const RECORD_GRACE_MINUTES = 15
export const NOT_RECORDED = 'approval not recorded: add merge-me again'

export type ReasonCode =
  | 'ci-red'
  | 'conflict'
  | 'merge-refused'
  | 'draft'
  | 'fork'
  | 'needs-jakub'
  | 'new-commits'
  | 'lower-bad'
  | 'threads'
  | 'not-recorded'

/** Re-arms per qualifying merge-me label (Jakub, 2026-11-27). */
export const MAX_REARMS = 3
export const CAP_NOTE = ` (${MAX_REARMS} re-arms used, add merge-me again)`

/** From the reason code, never from its text: a reworded reason must not change the kind. */
export function handoverKind(code: ReasonCode, rearms: number): HandoverKind {
  if (rearms >= MAX_REARMS) return 'final'
  if (code === 'ci-red') return 'ci'
  if (code === 'conflict' || code === 'merge-refused') return 'fix'
  return 'final'
}

export type HandOver = Extract<Action, { kind: 'hand-over' }>

/** The hand-over of `pr` for this reason: kind, count and red head. */
export function handOver(pr: PrFacts, code: ReasonCode, reason: string): HandOver {
  const as = handoverKind(code, pr.rearms)
  return {
    kind: 'hand-over',
    pr: pr.number,
    reason: pr.rearms >= MAX_REARMS ? `${reason}${CAP_NOTE}` : reason,
    as,
    n: pr.rearms + 1,
    redSha: as === 'ci' ? pr.headSha : null,
  }
}

export function entryCheck(
  pr: PrFacts,
): { ok: true } | { ok: false; code: ReasonCode; reason: string } {
  if (pr.draft) return { ok: false, code: 'draft', reason: 'draft' }
  if (pr.fromFork) return { ok: false, code: 'fork', reason: 'PR from a fork' }
  if (pr.needsJakubAfterLabel) {
    return { ok: false, code: 'needs-jakub', reason: 'open question (needs-jakub)' }
  }
  if (!pr.headIsApproved) {
    return { ok: false, code: 'new-commits', reason: 'new commits after the label' }
  }
  if (pr.lower === 'bad') {
    return {
      ok: false,
      code: 'lower-bad',
      reason: 'its lower PR changed after the label, or it was not up to date with it',
    }
  }
  if (pr.ci === 'red') return { ok: false, code: 'ci-red', reason: 'CI red' }
  if (pr.unresolvedThreads > 0) {
    const n = pr.unresolvedThreads
    return { ok: false, code: 'threads', reason: `${n} unresolved thread${n === 1 ? '' : 's'}` }
  }
  return { ok: true }
}

/**
 * A PR with an open hand-over. 'resume': back in the queue now. 'parked': red CI, waits for a
 * newer green head (and may be updated with main). 'skip': nothing to do.
 */
function afterHandover(pr: PrFacts): 'resume' | 'parked' | 'skip' {
  const h = pr.handover
  if (!h || h.kind === 'final') return 'skip'
  if (pr.headSha === h.redSha)
    return h.kind === 'ci' && entryCheck({ ...pr, ci: 'green' }).ok ? 'parked' : 'skip'
  // The owner thread's request: CI may still be pending, not red.
  if (pr.rearmRequest === pr.headSha && pr.headIsFixed) {
    if (entryCheck({ ...pr, headIsApproved: true }).ok) return 'resume'
  }
  if (h.kind !== 'ci') return 'skip'
  // Strict facts: only GitHub's update merges after the baseline; red CI is why it is parked.
  if (!entryCheck({ ...pr, ci: pr.ci === 'red' ? 'green' : pr.ci }).ok) return 'skip'
  return pr.ci === 'green' ? 'resume' : 'parked'
}

function isLandable(pr: PrFacts): boolean {
  return pr.baseIsMain && !pr.stack && pr.lower !== 'pending'
}

export function nextActions(prs: PrFacts[]): Action[] {
  const actions: Action[] = []
  const passing: PrFacts[] = []
  const parked: PrFacts[] = []
  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    if (pr.handover) {
      const next = afterHandover(pr)
      if (next === 'resume') {
        const { n } = pr.handover
        actions.push({ kind: 'resume', pr: pr.number, n, sha: pr.headSha })
        passing.push({ ...pr, headIsApproved: true, handover: null, rearms: n })
      } else if (next === 'parked') parked.push(pr)
      continue
    }
    if (pr.approvedSha === null) {
      if (pr.labelAgeMinutes >= RECORD_GRACE_MINUTES) {
        actions.push(handOver(pr, 'not-recorded', NOT_RECORDED))
      }
      continue
    }
    const check = entryCheck(pr)
    if (check.ok) passing.push(pr)
    else actions.push(handOver(pr, check.code, check.reason))
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
  const landable = passing.filter(isLandable)
  for (const pr of passing) {
    if (!landable.includes(pr) && !(pr.stack && unstacked.has(pr.stack.number))) {
      actions.push({
        kind: 'wait',
        pr: pr.number,
        for: pr.stack ? 'its whole stack' : 'its lower PR to merge',
      })
    }
  }
  // A parked PR never holds the queue: it is the active one only to be updated with main, and
  // only when no other PR can move.
  const active =
    landable.find((pr) => pr.updatedByAction) ??
    landable[0] ??
    parked.find((pr) => isLandable(pr) && pr.behind)
  for (const pr of parked) {
    if (pr === active) continue
    if (pr.ci === 'red') actions.push({ kind: 'wait', pr: pr.number, for: 'CI red, parked' })
    else if (pr.ci === 'pending') actions.push({ kind: 'wait', pr: pr.number, for: 'CI' })
  }
  if (active) {
    if (active.behind) actions.push({ kind: 'update', pr: active.number })
    else if (active.ci === 'green') {
      actions.push({ kind: 'merge', pr: active.number, sha: active.headSha })
    } else actions.push({ kind: 'wait', pr: active.number, for: 'CI' })
  }
  return actions.length > 0 ? actions : [{ kind: 'idle' }]
}
