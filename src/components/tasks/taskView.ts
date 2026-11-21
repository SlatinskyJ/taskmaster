import { toPragueWallTime } from '~/domain/dates'
import type { Role } from '~/domain/parties'
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
  | { action: 'approveOffer' | 'acceptOffer' | 'placeBid'; data: { taskId: number; score: number } }
  | {
      action: 'acceptLowestTaskBid' | 'counterOffer'
      data: { taskId: number; score: number; bidders: number[] }
    }
export type BidAction = BidCall['action']

export type BidButton = BidCall & {
  key: string
  label: string
  hint: string
  variant: 'ok' | 'ghost'
}

export type SendButton = BidCall & { label: string; hint: string; disabled: boolean }

/** The chip: a proposed task someone bid on is "Vyjednává se"; done but unconfirmed is pending. */
export function taskChipState(task: Pick<TaskView, 'status' | 'bids'>): ItemStateKey {
  if (task.status === 'proposed') return task.bids.length > 0 ? 'negotiating' : 'proposed'
  if (task.status === 'done_unconfirmed') return 'pending'
  return task.status
}

/** Hotovo and Uvolnit (spec §5.4, §5.5): only the brother who reserved the task. */
export function canWorkOn(task: Pick<TaskView, 'status' | 'reservedBy'>, me: Me): boolean {
  return me.role === 'taker' && task.status === 'reserved' && task.reservedBy?.id === me.id
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
  if (task.status !== 'proposed') return []
  const offer = { taskId: task.id, score: task.score }
  if (me.role === 'taker') {
    if (task.approverIds.includes(me.id)) return []
    const bid = myBid(task, me)
    const approve: BidButton = {
      key: 'approve',
      action: 'approveOffer',
      data: offer,
      label: cs.tasks.approve,
      hint: cs.bids.approveHint,
      variant: bid === null ? 'ok' : 'ghost',
    }
    if (bid === null) return [approve]
    const take: BidButton = {
      key: 'take',
      action: 'acceptOffer',
      data: offer,
      label: cs.bids.take(task.score),
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
  if (task.status !== 'proposed') return null
  const data = { taskId: task.id, score: value }
  if (me.role === 'taker') {
    return {
      action: 'placeBid',
      data,
      label: cs.bids.send,
      hint: cs.bids.bidHint,
      disabled: value === task.score || value === myBid(task, me),
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
    disabled: value === task.score,
  }
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
  const day = cs.bids.weekdays[t.weekday]
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${day} ${pad(t.hour)}:${pad(t.minute)}`
}

/** The task id from the URL: plain positive digits only, else null (→ not found). */
export function parseTaskIdParam(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

/** The toast after a bidding action succeeded, from the status the server returned. */
export function toastFor(action: BidAction, status: TaskView['status'], me: Me): string {
  if (status === 'reserved' && me.role === 'taker') return cs.bids.toast.agreedMine
  if (status === 'open' || status === 'reserved') return cs.bids.toast.agreed
  if (action === 'approveOffer') return cs.tasks.approved
  return cs.bids.toast.sent
}
