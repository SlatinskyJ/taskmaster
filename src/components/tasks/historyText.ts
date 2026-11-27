import { parseIsoUtc, toPragueWallTime } from '~/domain/dates'
import { cs } from '~/lib/strings'
import type { HistoryEntry } from '~/server/tasks/functions'

// A task's history (#36, GTask "Historie") as chat bubbles (#248): the phrase of each entry, the
// time shown on a tap, and the layout list. Framework-free, so the same text renders on the server
// and in the browser. The live change notice (src/server/live/text.ts) uses `historyText` too, so
// a task's Historie and the notice share one wording: keep this file framework-free.

const pad = (n: number) => String(n).padStart(2, '0')

/** Prague time, `so 21. 11. 10:12`. */
export function historyTime(iso: string): string {
  const t = toPragueWallTime(parseIsoUtc(iso))
  const day = cs.weekdays[t.weekday]
  return `${day} ${String(t.day)}. ${String(t.month)}. ${pad(t.hour)}:${pad(t.minute)}`
}

/** The phrase without time or name: "chce 12 b". */
export function historyText(e: HistoryEntry, meId: number): string {
  const h = cs.history
  const n = e.score ?? 0
  switch (e.action) {
    case 'task.created':
      return h.created(n)
    case 'task.score_offered':
    case 'task.score_countered':
      return h.countered(n)
    case 'task.bid_placed':
      return h.bid(n)
    case 'task.bid_accepted':
      return h.bidAccepted(n)
    case 'task.bid_withdrawn':
      return h.bidWithdrawn
    case 'task.bids_turned_down':
      return h.bidsTurnedDown
    case 'task.bidding_reopened':
      return h.biddingReopened
    case 'task.bidding_closed':
      return h.biddingClosed
    case 'task.score_approved':
      return h.approved(n)
    case 'task.agreed':
      return e.reservedBy
        ? h.agreedReserved(n, e.reservedBy.id === meId ? h.you : e.reservedBy.name)
        : h.agreed(n)
    case 'task.reserved':
      return h.reserved
    case 'task.released':
      return h.released
    case 'task.completed':
      return h.completed
    case 'task.approved':
      return h.completionApproved
    case 'task.rejected':
      return h.rejected
    case 'task.cancelled':
      return h.cancelled
    case 'task.score_change_proposed':
      return h.changeProposed(n)
    case 'task.score_change_approved':
      return h.changeApproved(n)
    case 'task.score_change_declined':
      return h.changeDeclined(n)
    case 'task.score_change_withdrawn':
      return h.changeWithdrawn
    case 'task.score_changed':
      return h.changed(n)
    case 'task.score_change_discarded':
      return h.changeDiscarded(n)
    case 'task.description_changed':
      return h.descriptionChanged
    case 'task.description_change_proposed':
      return h.descriptionProposed
    case 'task.description_change_approved':
      return h.descriptionApproved
    case 'task.description_change_declined':
      return h.descriptionDeclined
    case 'task.description_change_withdrawn':
      return h.descriptionWithdrawn
    case 'task.description_change_discarded':
      return h.descriptionDiscarded
    case 'instance.created':
      return e.by ? h.instanceCreated(n) : h.scheduledCreated(n)
    case 'instance.expired':
      return h.expired
    case 'instance.self_logged':
      return h.selfLogged(n)
    default:
      return h.other
  }
}

export function historyReason(e: HistoryEntry): string | null {
  return e.reason ? `„${e.reason}“` : null
}

/**
 * Where each bidding round starts in a task's history (#212, Jakub 2026-11-26: Historie shows
 * every round, clearly split). Only once the price was reopened: the first entry starts round 1
 * and each reopen the next. Entry id → round number.
 */
export function historyRounds(entries: readonly HistoryEntry[]): ReadonlyMap<number, number> {
  const starts = new Map<number, number>()
  const first = entries[0]
  if (!first || !entries.some((e) => e.action === 'task.bidding_reopened')) return starts
  starts.set(first.id, 1)
  for (const e of entries) {
    if (e.action === 'task.bidding_reopened') starts.set(e.id, starts.size + 1)
  }
  return starts
}

export type HistoryItem =
  | { kind: 'round'; key: string; round: number }
  | { kind: 'note'; id: number; text: string; reason: string | null; time: string }
  | {
      kind: 'bubble'
      id: number
      side: 'mine' | 'theirs'
      /** Shown above the bubble: only on theirs, only on the first bubble of a run. */
      name: string | null
      text: string
      reason: string | null
      time: string
      /** The item above / below is a bubble by the same person (a run). */
      joinAbove: boolean
      joinBelow: boolean
    }

type Bubble = Extract<HistoryItem, { kind: 'bubble' }>

/**
 * The history as layout items (#248, Jakub 2026-11-26): my entries a bubble on the left, everyone
 * else's on the right, the system's a centred note. Newest on top (Jakub 2026-11-26 20:01): the
 * latest bidding round first, each under its divider, newest entry first within it. Bubbles by the
 * same person in a row are a run; a round, a note or another person ends it.
 */
export function historyItems(entries: readonly HistoryEntry[], meId: number): HistoryItem[] {
  const rounds = historyRounds(entries)
  // Oldest first, split where a round starts; a history never reopened is one group with no round.
  const groups: { round: number | undefined; entries: HistoryEntry[] }[] = []
  let current: { round: number | undefined; entries: HistoryEntry[] } | undefined
  for (const e of entries) {
    const round = rounds.get(e.id)
    if (!current || round !== undefined) {
      current = { round, entries: [] }
      groups.push(current)
    }
    current.entries.push(e)
  }
  const items: HistoryItem[] = []
  // The bubble above, while the run can still go on, and whose it is.
  let last: { bubble: Bubble; byId: number } | null = null
  for (const group of groups.reverse()) {
    if (group.round !== undefined) {
      items.push({ kind: 'round', key: `round-${String(group.round)}`, round: group.round })
      last = null
    }
    for (const e of [...group.entries].reverse()) {
      const text = historyText(e, meId)
      const reason = historyReason(e)
      const time = historyTime(e.at)
      if (!e.by) {
        items.push({ kind: 'note', id: e.id, text, reason, time })
        last = null
        continue
      }
      const mine = e.by.id === meId
      const joinAbove = last?.byId === e.by.id
      if (last && joinAbove) last.bubble.joinBelow = true
      const bubble: Bubble = {
        kind: 'bubble',
        id: e.id,
        side: mine ? 'mine' : 'theirs',
        name: mine || joinAbove ? null : e.by.name,
        text,
        reason,
        time,
        joinAbove,
        joinBelow: false,
      }
      items.push(bubble)
      last = { bubble, byId: e.by.id }
    }
  }
  return items
}
