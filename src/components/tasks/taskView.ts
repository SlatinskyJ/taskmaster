import { parseIsoUtc, toPragueWallTime } from '~/domain/dates'
import type { Role } from '~/domain/parties'
import { formatDue, formatPragueTime, formatSince } from '~/lib/formatDate'
import { cs } from '~/lib/strings'
import type { ItemStateKey } from '~/lib/strings'
import type { TaskView } from '~/server/tasks/functions'

// What the bidding screens show and send (#34, spec §5.2). Framework-free and unit-tested:
// components only render what these return. The server checks every call again; a screen
// sends back exactly what it showed, so a stale one is refused ("offer changed"), never agreed.

export interface Me {
  id: number
  role: Role
}

/** One call to a bidding server function; `bidders` only where the server needs it. */
export type BidCall =
  | {
      action: 'approveOffer' | 'acceptOffer' | 'placeBid'
      // The text the page showed (#207): the server refuses it as stale if it changed.
      data: { taskId: number; score: number; seenDescription: string | null }
    }
  | {
      action: 'acceptLowestTaskBid' | 'counterOffer'
      data: { taskId: number; score: number; bidders: number[] }
    }
  | { action: 'withdrawBid'; data: { taskId: number } }
  | { action: 'turnDownBids'; data: { taskId: number; bids: { takerId: number; score: number }[] } }
  | { action: 'reopenBidding'; data: { taskId: number } }
export type BidAction = BidCall['action']

export type BidButton = BidCall & {
  key: string
  label: string
  hint: string
  variant: 'ok' | 'ghost'
}

export type SendButton = BidCall & { label: string; hint: string; disabled: boolean }

/** A proposed task, or an open one in a reopened round (#212): there is something to bid on. */
export function negotiating(task: Pick<TaskView, 'status' | 'rebidding'>): boolean {
  return task.status === 'proposed' || task.rebidding !== null
}

/** The score a yes or a bid answers: a round's current offer, else the task's score. */
export function offerScore(task: Pick<TaskView, 'score' | 'rebidding'>): number {
  return task.rebidding?.offer ?? task.score
}

/**
 * The chip: a proposed task someone bid on is "Vyjednává se", as is a reopened round (#212);
 * done but unconfirmed is pending.
 */
export function taskChipState(task: Pick<TaskView, 'status' | 'bids' | 'rebidding'>): ItemStateKey {
  if (task.rebidding) return 'negotiating'
  if (task.status === 'proposed') return task.bids.length > 0 ? 'negotiating' : 'proposed'
  if (task.status === 'done_unconfirmed') return 'pending'
  return task.status
}

/** Hotovo and Uvolnit (spec §5.4, §5.5): only the brother who reserved the task. */
export function canWorkOn(task: Pick<TaskView, 'status' | 'reservedBy'>, me: Me): boolean {
  return me.role === 'taker' && task.status === 'reserved' && task.reservedBy?.id === me.id
}

/** Rezervovat and Hotovo on a free task's page (spec §5.4, #195): a brother, on an open task. */
export function canTakeFree(task: Pick<TaskView, 'status'>, me: Me): boolean {
  return me.role === 'taker' && task.status === 'open'
}

/**
 * A week copy of a later day (#257, spec §5.12): it can be reserved or released already, but
 * Hotovo only from its day on.
 */
export function laterDay(task: Pick<TaskView, 'planDay'>, now: Date): boolean {
  return task.planDay !== null && parseIsoUtc(task.planDay).getTime() > now.getTime()
}

/** A week copy's day as its row shows it: the short weekday, capitalised ("Čt"). */
export function dayLabel(planDay: string): string {
  const day = cs.weekdays[toPragueWallTime(parseIsoUtc(planDay)).weekday]
  return day.charAt(0).toUpperCase() + day.slice(1)
}

/** ✓ Schválit / ✕ Zamítnout (spec §5.5, #206): a parent, on done work not yet confirmed. */
export function canApprove(task: Pick<TaskView, 'status'>, me: Me): boolean {
  return me.role === 'giver' && task.status === 'done_unconfirmed'
}

/** His own open bid, never another brother's. */
export function myBid(task: TaskView, me: Me): number | null {
  return task.bids.find((b) => b.takerId === me.id)?.score ?? null
}

function names(list: readonly { name: string }[]): string {
  return list.map((p) => p.name).join(', ')
}

/** The yes buttons, top to bottom (spec §5.2: a bidder's yes picks). */
export function bidButtons(task: TaskView, me: Me): BidButton[] {
  if (!negotiating(task)) return []
  const round = task.rebidding
  const offer = { taskId: task.id, score: offerScore(task) }
  if (me.role === 'taker') {
    // A round's opening offer is nobody's: taking it at that price is Rezervovat (#212).
    if (round?.offeredBy === null) return []
    if (task.approverIds.includes(me.id)) return []
    const bid = myBid(task, me)
    const seen = { ...offer, seenDescription: task.description }
    const approve: BidButton = {
      key: 'approve',
      action: 'approveOffer',
      data: seen,
      label: cs.tasks.approve,
      hint: round ? cs.rebid.approveHint(round.offer) : cs.bids.approveHint,
      variant: bid === null ? 'ok' : 'ghost',
    }
    if (bid === null) return [approve]
    const take: BidButton = {
      key: 'take',
      action: 'acceptOffer',
      data: seen,
      label: cs.bids.take(offer.score),
      hint: cs.bids.takeHint,
      variant: 'ok',
    }
    return [take, approve]
  }
  if (me.role === 'giver' && task.lowest) {
    const { score, bidders } = task.lowest
    return [
      {
        key: 'yes',
        action: 'acceptLowestTaskBid',
        data: { taskId: task.id, score, bidders: bidders.map((p) => p.id) },
        ...acceptTexts(score, bidders),
        variant: 'ok',
      },
    ]
  }
  return []
}

function acceptTexts(score: number, bidders: readonly { name: string }[]) {
  const [only] = bidders
  return bidders.length === 1 && only
    ? { label: cs.bids.acceptBid(score, only.name), hint: cs.bids.acceptBidHint(only.name) }
    : { label: cs.bids.acceptTie(score), hint: cs.bids.tieHint }
}

/**
 * The send button under the stepper. A brother bids; a parent makes a new offer, or, on a number
 * brothers bid, accepts their bids (decision 8b).
 */
export function sendButton(task: TaskView, me: Me, value: number): SendButton | null {
  if (!negotiating(task)) return null
  const current = offerScore(task)
  const data = { taskId: task.id, score: value }
  if (me.role === 'taker') {
    // Same number (Jakub 2026-11-24): his previous bid only after the offer changed.
    const again = value !== current && value === lastBid(task, me)
    return {
      action: 'placeBid',
      data: { ...data, seenDescription: task.description },
      label: cs.bids.send,
      hint: again ? cs.bids.sameAgainHint : cs.bids.bidHint,
      disabled: value === current || again,
    }
  }
  if (me.role !== 'giver') return null
  const at = task.bids
    .filter((b) => b.score === value)
    .map((b) => ({ id: b.takerId, name: b.name }))
  const texts =
    at.length === 0 ? { label: cs.bids.send, hint: cs.bids.sendHint } : acceptTexts(value, at)
  return {
    action: 'counterOffer',
    data: { ...data, bidders: at.map((p) => p.id) },
    ...texts,
    disabled: value === current,
  }
}

/** His previous bid in this round (open or withdrawn), never another brother's. */
function lastBid(task: TaskView, me: Me): number | null {
  return task.lastBids.find((b) => b.takerId === me.id)?.score ?? null
}

/**
 * Saying no (#208, switch `bidRefusals`): a brother's Nechci closes his own open bid; a parent's
 * Odmítnout nabídky closes every bid he sees, sent back so a bid that came in meanwhile is
 * refused, not dropped unseen.
 */
export function refuseButton(task: TaskView, me: Me, on: boolean): BidButton | null {
  if (!on || !negotiating(task)) return null
  const round = task.rebidding !== null
  if (me.role === 'taker' && myBid(task, me) !== null) {
    return {
      key: 'refuse',
      action: 'withdrawBid',
      data: { taskId: task.id },
      label: cs.bids.withdraw,
      hint: cs.bids.withdrawHint,
      variant: 'ghost',
    }
  }
  if (me.role === 'giver' && task.bids.length > 0) {
    return {
      key: 'refuse',
      action: 'turnDownBids',
      data: {
        taskId: task.id,
        bids: task.bids.map((b) => ({ takerId: b.takerId, score: b.score })),
      },
      label: cs.bids.turnDown,
      hint: round ? cs.rebid.turnDownHint(task.score) : cs.bids.turnDownHint(task.score),
      variant: 'ghost',
    }
  }
  return null
}

/**
 * "Vyjednat novou cenu" (#212, switch `reopenBidding`): a free, agreed one-time task with no
 * round and no price change in flight; any brother or parent.
 */
export function reopenButton(task: TaskView, me: Me, on: boolean): BidButton | null {
  if (!on || task.origin !== 'one_time' || task.status !== 'open') return null
  if (task.rebidding !== null || task.scoreChange !== null) return null
  if (me.role !== 'giver' && me.role !== 'taker') return null
  return {
    key: 'reopen',
    action: 'reopenBidding',
    data: { taskId: task.id },
    label: cs.rebid.reopen,
    hint: cs.rebid.reopenHint(task.score),
    variant: 'ghost',
  }
}

/** The header lines of a round: who countered, and that the agreed score still applies. */
export function roundLines(task: Pick<TaskView, 'score' | 'rebidding'>): string[] {
  const round = task.rebidding
  if (!round) return []
  const by = round.offeredBy
  const counter = by ? [cs.rebid.offer(by.name, round.offer)] : []
  return [...counter, cs.taskPrice.oldStays(task.score)]
}

/** A "Čeká na tebe" row's short line: who offers, and my bid next to it. */
export function waitingMeta(task: TaskView, me: Me): string {
  const by = task.offeredByName ?? task.createdByName
  const bid = myBid(task, me)
  if (bid === null) return `${cs.tasks.offeredBy} ${by}`
  return `${by} ${String(task.score)} · ${cs.bids.you} ${String(bid)}`
}

/** Who the offer still waits for; any one of them agreeing is enough. */
export function waitingText(task: TaskView, me: Me): string | null {
  if (task.status !== 'proposed' || task.waitingFor.length === 0) return null
  const who = task.waitingFor.map((p) => (p.id === me.id ? cs.bids.youAcc : p.name))
  return `${cs.bids.waitingFor}: ${who.join(` ${cs.bids.or} `)}`
}

/**
 * GHome "Čeká na kluky" (#41): offers with no bid yet that still wait only for the boys. One
 * waiting for this parent is in "Čeká na tebe"; one with bids is in "Vyjednávání".
 */
export function waitingOnTakers(list: readonly TaskView[], me: Me): TaskView[] {
  return list.filter(
    (t) =>
      t.status === 'proposed' &&
      t.bids.length === 0 &&
      t.waitingFor.length > 0 &&
      !t.waitingFor.some((p) => p.id === me.id),
  )
}

export function lowestText(lowest: NonNullable<TaskView['lowest']>): string {
  const verb = lowest.bidders.length === 1 ? cs.bids.wants : cs.bids.wantMany
  return `${names(lowest.bidders)} ${verb} ${String(lowest.score)}`
}

/** The task page's line under the score. */
export function detailMeta(task: TaskView, me: Me): string | null {
  if (task.status === 'proposed') {
    return `${cs.tasks.offeredBy} ${task.offeredByName ?? task.createdByName}`
  }
  if (task.status === 'reserved' && task.reservedBy) {
    return task.reservedBy.id === me.id
      ? cs.bids.yours
      : `${cs.work.reservedBy} ${task.reservedBy.name}`
  }
  if (task.completedBy) return `${cs.work.doneBy} ${task.completedBy.name}`
  return null
}

/** "so 10:12": weekday and time on the Prague wall clock. */
export function threadTime(iso: string): string {
  const t = toPragueWallTime(new Date(iso))
  const day = cs.weekdays[t.weekday]
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day} ${pad(t.hour)}:${pad(t.minute)}`
}

/** The toast after a bidding action succeeded, from the status the server returned. */
/**
 * The toast after a bidding action succeeded. `round`: the task was in a reopened round when
 * tapped (#212); it stays open whether agreed or not, so the call decides, not the status.
 */
export function toastFor(
  call: BidCall,
  status: TaskView['status'],
  me: Me,
  round: boolean,
): string {
  if (call.action === 'reopenBidding') return cs.rebid.toast.reopened
  if (call.action === 'turnDownBids') return cs.bids.toast.turnedDown
  const mine = status === 'reserved' && me.role === 'taker'
  if (round) {
    if (call.action === 'placeBid') return cs.bids.toast.sent
    if (call.action === 'withdrawBid') return cs.bids.toast.withdrawn
    if (call.action === 'counterOffer' && call.data.bidders.length === 0) return cs.bids.toast.sent
    return mine ? cs.bids.toast.agreedMine : cs.bids.toast.agreed
  }
  if (mine) return cs.bids.toast.agreedMine
  if (status === 'open' || status === 'reserved') return cs.bids.toast.agreed
  if (call.action === 'approveOffer') return cs.tasks.approved
  if (call.action === 'withdrawBid') return cs.bids.toast.withdrawn
  return cs.bids.toast.sent
}

// ── Price change (#36, spec §5.2) ────────────────────────────────────────────────────────

/**
 * "Změnit cenu": no change in flight; open → any giver or taker; reserved → a giver or its
 * taker. With `rebid` (switch `reopenBidding`, #212) an open task changes price by a new round.
 */
export function canProposeChange(
  task: Pick<TaskView, 'status' | 'reservedBy' | 'scoreChange'>,
  me: Me,
  rebid = false,
): boolean {
  if (task.scoreChange) return false
  if (me.role !== 'giver' && me.role !== 'taker') return false
  if (task.status === 'open') return !rebid
  if (task.status === 'reserved') return me.role === 'giver' || task.reservedBy?.id === me.id
  return false
}

/** What this person may answer to the change in flight (Jakub 2026-11-21: only who it waits for). */
export function changeAnswer(
  task: Pick<TaskView, 'scoreChange'>,
  me: Me,
): 'answer' | 'withdraw' | 'none' {
  const change = task.scoreChange
  if (!change) return 'none'
  if (change.proposedBy.id === me.id) return 'withdraw'
  return change.waitingFor.some((p) => p.id === me.id) ? 'answer' : 'none'
}

/** The hint under "Změnit cenu": reserved → who has to agree; open → both sides. */
export function changeHint(task: Pick<TaskView, 'status' | 'reservedBy'>, me: Me): string {
  if (task.status === 'reserved' && task.reservedBy) {
    return cs.taskPrice.needs(me.role === 'giver' ? task.reservedBy.name : cs.taskPrice.parent)
  }
  return cs.taskPrice.needsOpen
}

/**
 * The meta line of an instance row (#38): its due time ("do zítra 7:00", "po termínu"), or for
 * an on-demand one without a deadline when it was made ("na vyžádání · 15:02"), for a scheduled
 * one when its slot was ("včera 7:00 · podle rozvrhu", #39). Else undefined (also expired).
 */
export function instanceMeta(
  task: Pick<TaskView, 'status' | 'origin' | 'dueAt' | 'graceEndsAt' | 'createdAt'> & {
    planDay?: string | null
  },
  now: Date,
): string | undefined {
  // The Prošlo chip says it all; "po termínu" beside it would say it twice.
  if (task.status === 'expired') return undefined
  const due =
    task.dueAt !== null && task.graceEndsAt !== null
      ? formatDue(task.dueAt, task.graceEndsAt, now)
      : undefined
  // A week copy for a later day (#257) says its day (and its due time), not when it was made.
  if (task.planDay != null && laterDay({ planDay: task.planDay }, now)) {
    const { weekday, day, month } = toPragueWallTime(parseIsoUtc(task.planDay))
    const planned = cs.instances.plannedFor(
      `${cs.weekdays[weekday]} ${String(day)}. ${String(month)}.`,
    )
    return due === undefined ? planned : `${planned} · ${due}`
  }
  if (due !== undefined) return due
  if (task.origin === 'on_demand') return cs.instances.onDemandAt(formatPragueTime(task.createdAt))
  if (task.origin === 'scheduled') return cs.instances.scheduledAt(formatSince(task.createdAt, now))
  return undefined
}
