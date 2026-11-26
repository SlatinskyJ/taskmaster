import { getRequestHeader } from '@tanstack/react-start/server'
import { asc, gt, inArray, max, or } from 'drizzle-orm'
import { onAuditWritten } from '~/server/audit'
import type { AuditAction, AuditLogRow, EntityType } from '~/server/audit'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import { auditLog } from '~/server/db/schema'
import { topicsOf } from './mapping'
import type { Topic } from './topics'

// The in-process hub (#299): every committed change becomes one event for each open stream
// whose topics it touches (./README.md). One server, one process: the hub keeps no history; a
// stream that reconnects catches up from the audit log (`changesSince`).

/** What a stream sends per change. Never `before` / `after` (audit README rule). */
export interface LiveEvent {
  /** The newest audit id in the change: the SSE event id. */
  id: number
  /** The change's key: `change_id ?? id` of its first entry. */
  change: number
  /** Of the change's first entry that the stream subscribed to (its main entry for it). */
  action: AuditAction
  entityType: EntityType
  entityId: string
  actor: { kind: 'user'; userId: number } | { kind: 'system' }
  at: string
}

export interface Stream {
  sessionId: number
  userId: number
  /** The tab that opened it (`x-tm-tab`); a change made from this tab is not echoed to it. */
  tab: string
  topics: ReadonlySet<Topic>
  send(e: LiveEvent): void
  close(): void
}

export interface Hub {
  /**
   * Starts sending changes newer than `lastId` to the stream. A session's fourth stream closes
   * its oldest; past `STREAMS_TOTAL` it is refused (`null`). Returns the detach.
   */
  attach(s: Stream, lastId: number): (() => void) | null
  /** Catch-up: the matching changes whose newest id is above `afterId`, oldest first. */
  changesSince(
    afterId: number,
    topics: ReadonlySet<Topic>,
    limit: number,
  ): { events: LiveEvent[]; overflow: boolean; lastId: number }
  /** Number of attached streams (tests, logs). */
  size(): number
  stop(): void
}

/** Streams per session: a login is one device, one or two tabs (design "Limits") [call]. */
export const STREAMS_PER_SESSION = 3
/** A backstop over every session. */
export const STREAMS_TOTAL = 50
/** The header a tab's server function calls carry (src/start.ts). */
export const TAB_HEADER = 'x-tm-tab'

interface Entry {
  row: AuditLogRow
  topics: Topic[]
}

interface Change {
  key: number
  newest: number
  entries: Entry[]
}

/** The request's tab id, or undefined outside a request (the scheduler) or without one. */
function requestTab(): string | undefined {
  try {
    const tab = getRequestHeader(TAB_HEADER)
    return tab && tab.length <= 64 ? tab : undefined
  } catch {
    return undefined
  }
}

function safeTopics(db: Db, row: AuditLogRow): Topic[] {
  try {
    return topicsOf(db, row)
  } catch (err) {
    console.error(`[live] no topics for audit entry ${String(row.id)}`, err)
    return []
  }
}

/** Groups rows (ordered by id) into changes, each entry with its own topics. */
function group(db: Db, rows: readonly AuditLogRow[]): Change[] {
  const byKey = new Map<number, Change>()
  for (const row of rows) {
    const key = row.changeId ?? row.id
    let change = byKey.get(key)
    if (!change) {
      change = { key, newest: row.id, entries: [] }
      byKey.set(key, change)
    }
    change.newest = Math.max(change.newest, row.id)
    change.entries.push({ row, topics: safeTopics(db, row) })
  }
  return [...byKey.values()].sort((a, b) => a.newest - b.newest)
}

/** The change as `topics` sees it, or null when none of its entries touches them. */
function eventFor(change: Change, topics: ReadonlySet<Topic>): LiveEvent | null {
  const seen = change.entries.find((e) => e.topics.some((t) => topics.has(t)))
  if (!seen) return null
  const { row } = seen
  return {
    id: change.newest,
    change: change.key,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actor:
      row.actorKind === 'user' && row.actorUserId !== null
        ? { kind: 'user', userId: row.actorUserId }
        : { kind: 'system' },
    at: row.at,
  }
}

export function createHub(db: Db, opts: { originTab?: () => string | undefined } = {}): Hub {
  const originTab = opts.originTab ?? requestTab
  /** Attached streams, oldest first, with the newest id each has been sent (or skipped). */
  const streams = new Map<Stream, { lastId: number }>()
  const newestId = () =>
    db
      .select({ id: max(auditLog.id) })
      .from(auditLog)
      .get()?.id ?? 0
  let lastSent = newestId()
  let pending: { origin: string | undefined } | null = null

  function detach(s: Stream): void {
    streams.delete(s)
  }

  function flush(origin: string | undefined): void {
    const rows = db
      .select()
      .from(auditLog)
      .where(gt(auditLog.id, lastSent))
      .orderBy(asc(auditLog.id))
      .all()
    const last = rows.at(-1)
    if (!last) return
    lastSent = last.id
    const changes = group(db, rows)
    for (const [stream, state] of [...streams]) {
      if (origin !== undefined && stream.tab === origin) {
        state.lastId = Math.max(state.lastId, last.id)
        continue
      }
      for (const change of changes) {
        if (change.newest <= state.lastId) continue
        state.lastId = change.newest
        const event = eventFor(change, stream.topics)
        if (!event) continue
        try {
          stream.send(event)
        } catch (err) {
          console.error('[live] send failed; stream detached', err)
          detach(stream)
          try {
            stream.close()
          } catch {
            // Already gone.
          }
          break
        }
      }
    }
  }

  const unsubscribe = onAuditWritten(() => {
    if (pending) return
    pending = { origin: originTab() }
    queueMicrotask(() => {
      const origin = pending?.origin
      pending = null
      // A throw in a microtask would end the process: log it instead.
      try {
        flush(origin)
      } catch (err) {
        console.error('[live] flush failed', err)
      }
    })
  })

  return {
    attach(s, lastId) {
      const mine = [...streams.keys()].filter((o) => o.sessionId === s.sessionId)
      for (const old of mine.slice(0, Math.max(0, mine.length - STREAMS_PER_SESSION + 1))) {
        detach(old)
        old.close()
      }
      if (streams.size >= STREAMS_TOTAL) return null
      streams.set(s, { lastId })
      return () => {
        detach(s)
      }
    },

    changesSince(afterId, topics, limit) {
      const rows = db
        .select()
        .from(auditLog)
        .where(gt(auditLog.id, afterId))
        .orderBy(asc(auditLog.id))
        .all()
      // A change that began at or before `afterId` but ended after it: fetch its start too, so
      // its main entry is the right one (it is still sent once, by its newest id).
      const early = [
        ...new Set(
          rows.map((r) => r.changeId).filter((k): k is number => k !== null && k <= afterId),
        ),
      ]
      const head =
        early.length === 0
          ? []
          : db
              .select()
              .from(auditLog)
              .where(or(inArray(auditLog.id, early), inArray(auditLog.changeId, early)))
              .orderBy(asc(auditLog.id))
              .all()
              .filter((r) => r.id <= afterId)
      const events: LiveEvent[] = []
      let overflow = false
      for (const change of group(db, [...head, ...rows])) {
        const event = eventFor(change, topics)
        if (!event) continue
        if (events.length === limit) {
          overflow = true
          break
        }
        events.push(event)
      }
      return { events, overflow, lastId: rows.at(-1)?.id ?? afterId }
    },

    size: () => streams.size,

    stop() {
      unsubscribe()
      for (const s of [...streams.keys()]) {
        detach(s)
        s.close()
      }
    },
  }
}

let hub: Hub | null = null

/** The app's one hub, created on first use with the app database. */
export function liveHub(): Hub {
  hub ??= createHub(getDb())
  return hub
}
