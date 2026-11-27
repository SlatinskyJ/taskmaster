import { getRequestHeader } from '@tanstack/react-start/server'
import { and, asc, gt, inArray, lte, or } from 'drizzle-orm'
import { onAuditWritten } from '~/server/audit'
import type { AuditAction, AuditLogRow, EntityType } from '~/server/audit'
import { TAB_HEADER } from '~/lib/tab'
import type { Db } from '~/server/db'
import { getDb } from '~/server/db'
import { auditLog } from '~/server/db/schema'
import type { UserRole } from '~/server/db/schema'
import { cs } from '~/lib/strings'
import { topicsOf } from './mapping'
import { newestAuditId } from './subscription'
import { fallbackText, liveText } from './text'
import type { TitleCache, Viewer } from './text'
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
  /** The change's sentence for the stream's viewer (./text.ts). */
  text: string
}

export interface Stream {
  sessionId: number
  userId: number
  /** The user's role as signed in the stream's tokens: the viewer the event's text is for. */
  role: UserRole
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
    viewer: Viewer,
  ): { events: LiveEvent[]; overflow: boolean; lastId: number }
  /** Number of attached streams (tests, logs). */
  size(): number
  stop(): void
}

/** Streams per session: a login is one device, one or two tabs (design "Limits") [call]. */
export const STREAMS_PER_SESSION = 3
/**
 * Most audit rows a catch-up reads and maps; past it the stream gets one `overflow` (the
 * screen is many changes behind either way), so a long sleep never maps an unbounded log.
 */
export const CATCH_UP_ROWS = 1000
/** A backstop over every session. */
export const STREAMS_TOTAL = 50

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
export function requestTab(): string | undefined {
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

/** The entry's sentence for the viewer; a throw is logged and becomes "<actor> · změna". */
function safeText(db: Db, row: AuditLogRow, viewer: Viewer, cache: TitleCache): string {
  try {
    return liveText(db, row, viewer, cache)
  } catch (err) {
    console.error(`[live] no text for audit entry ${String(row.id)}`, err)
    try {
      return fallbackText(db, row, viewer)
    } catch {
      return cs.live.system + cs.live.sep + cs.history.other
    }
  }
}

/** The change as `topics` sees it, for `viewer`, or null when none of its entries touches them. */
function eventFor(
  db: Db,
  change: Change,
  topics: ReadonlySet<Topic>,
  viewer: Viewer,
  cache: TitleCache,
): LiveEvent | null {
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
    text: safeText(db, row, viewer, cache),
  }
}

export function createHub(db: Db, opts: { originTab?: () => string | undefined } = {}): Hub {
  const originTab = opts.originTab ?? requestTab
  /** Attached streams, oldest first, with the newest id each has been sent (or skipped). */
  const streams = new Map<Stream, { lastId: number }>()
  let lastSent = newestAuditId(db)
  /**
   * The tab each change since the last flush came from, by change key, set at its first entry.
   * A change is one synchronous run (audit README), so it never spans two flushes.
   */
  const origins = new Map<number, string | undefined>()
  let scheduled = false

  function detach(s: Stream): void {
    streams.delete(s)
  }

  function flush(): void {
    const from = new Map(origins)
    origins.clear()
    const rows = db
      .select()
      .from(auditLog)
      .where(gt(auditLog.id, lastSent))
      .orderBy(asc(auditLog.id))
      .all()
    const last = rows.at(-1)
    if (!last) return
    lastSent = last.id
    // Nobody listening: nothing to map.
    if (streams.size === 0) return
    const changes = group(db, rows)
    // One title read per (entity, viewer) for this flush.
    const cache: TitleCache = new Map()
    for (const [stream, state] of [...streams]) {
      const viewer = { id: stream.userId, role: stream.role }
      for (const change of changes) {
        if (change.newest <= state.lastId) continue
        state.lastId = change.newest
        // Made from this tab: it already shows it.
        const origin = from.get(change.key)
        if (origin !== undefined && origin === stream.tab) continue
        const event = eventFor(db, change, stream.topics, viewer, cache)
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

  const unsubscribe = onAuditWritten(({ id, changeId }) => {
    if (changeId === null) origins.set(id, originTab())
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      // A throw in a microtask would end the process: log it instead.
      try {
        flush()
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

    changesSince(afterId, topics, limit, viewer) {
      const rows = db
        .select()
        .from(auditLog)
        .where(gt(auditLog.id, afterId))
        .orderBy(asc(auditLog.id))
        .limit(CATCH_UP_ROWS + 1)
        .all()
      if (rows.length > CATCH_UP_ROWS) {
        return { events: [], overflow: true, lastId: newestAuditId(db) }
      }
      // A change that began at or before `afterId` but ended after it: fetch its start too, so
      // its main entry is the right one (it is still sent once, by its newest id). Capped too.
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
              .where(
                and(
                  lte(auditLog.id, afterId),
                  or(inArray(auditLog.id, early), inArray(auditLog.changeId, early)),
                ),
              )
              .orderBy(asc(auditLog.id))
              .limit(CATCH_UP_ROWS - rows.length + 1)
              .all()
      if (rows.length + head.length > CATCH_UP_ROWS) {
        return { events: [], overflow: true, lastId: newestAuditId(db) }
      }
      const events: LiveEvent[] = []
      let overflow = false
      const cache: TitleCache = new Map()
      for (const change of group(db, [...head, ...rows])) {
        const event = eventFor(db, change, topics, viewer, cache)
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
