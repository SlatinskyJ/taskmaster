import { parseIsoUtc, toPragueWallTime } from '~/domain/dates'
import { cs } from '~/lib/strings'
import type { HistoryEntry } from '~/server/tasks/functions'

// One line of a task's history (#36, GTask): "so 21. 11. 10:12 · Táta: nový úkol za 8 b".
// Framework-free, so the same text renders on the server and in the browser.

const pad = (n: number) => String(n).padStart(2, '0')

/** Prague time, `so 21. 11. 10:12`. */
export function historyTime(iso: string): string {
  const t = toPragueWallTime(parseIsoUtc(iso))
  const day = cs.weekdays[t.weekday]
  return `${day} ${String(t.day)}. ${String(t.month)}. ${pad(t.hour)}:${pad(t.minute)}`
}

function phrase(e: HistoryEntry, meId: number): string {
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

/** The line without the reason; the reason, when set, goes on its own line (`historyReason`). */
export function historyLine(e: HistoryEntry, meId: number): string {
  const who = e.by ? (e.by.id === meId ? cs.history.you : e.by.name) : null
  const what = phrase(e, meId)
  return `${historyTime(e.at)} · ${who ? `${who}: ${what}` : what}`
}

export function historyReason(e: HistoryEntry): string | null {
  return e.reason ? `„${e.reason}“` : null
}
