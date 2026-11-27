import { eq } from 'drizzle-orm'
import type { Db } from '~/server/db'
import { auditLog } from '~/server/db/schema'
import type { AuditAction, EntityType } from './actions'
import { currentScope } from './changeScope'
import type { ChangeScope, FirstEntry } from './changeScope'

/** A Drizzle transaction on the app database. Only code inside `withAudit` gets one. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export type Actor = { kind: 'user'; userId: number } | { kind: 'system' } | { kind: 'anonymous' }

export interface AuditEntry {
  actor: Actor
  action: AuditAction
  entityType: EntityType
  entityId: string | number
  /**
   * Relevant values before the change. Omit (or null) for creations. Must be
   * JSON-serialisable. Credential fields are redacted (see `CREDENTIAL_KEY`).
   */
  before?: unknown
  /** Values after the change, or the action's payload. Same rules as `before`. */
  after?: unknown
  reason?: string
  /**
   * Defaults to now (server clock). Only server code may set it (tests, the scheduler's
   * catch-up); never pass a time that came from a request, or entries could be back-dated.
   */
  at?: Date
}

/**
 * Keys whose values never reach the log, at any depth: password and PIN (hashes too),
 * session tokens, secrets, passkey credentials. The log is append-only and in every backup,
 * so a leaked secret could never be removed.
 */
const CREDENTIAL_KEY =
  /password|passwd|secret|token|^pin$|pin_?(hash|code)|new_?pin|credential|private_?key|challenge/i
export const REDACTED = '[redacted]'

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, CREDENTIAL_KEY.test(k) ? REDACTED : redact(v)]),
    )
  }
  return value
}

function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const json = JSON.stringify(redact(value))
  // JSON.stringify returns undefined for functions/symbols; refuse rather than store nothing.
  if (typeof json !== 'string') throw new TypeError('Audit value is not JSON-serialisable')
  return json
}

/** Rejects promise-returning changes at compile time (better-sqlite3 transactions are sync). */
type NotAsync<T> = T extends PromiseLike<unknown> ? never : T

/** What a write listener hears: the new entry's id and its change (`null`: it starts one). */
export interface AuditWritten {
  id: number
  changeId: number | null
}

type AuditListener = (row: AuditWritten) => void
const listeners = new Set<AuditListener>()

/**
 * Calls `listener` synchronously after every audit insert, inside the writer's transaction
 * (which may still roll back: a listener must read the log only after the current synchronous
 * run, e.g. in a microtask). Returns the unsubscribe. A throwing listener is logged and never
 * breaks the write. The live hub (~/server/live) is the one user.
 */
export function onAuditWritten(listener: AuditListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Outside a request's scope (the scheduler): the first entry of the current change. One change
 * is one synchronous run (README); reset in a microtask, so the next tick starts a new change.
 */
const fallback: ChangeScope = { first: null }

/**
 * The run's change is still in the log: the row with its first entry's id is that entry (not
 * rolled back, and its freed id not taken by another request's row since).
 */
function changeAlive(tx: Tx, first: FirstEntry): boolean {
  const row = tx
    .select({ action: auditLog.action, entityId: auditLog.entityId, at: auditLog.at })
    .from(auditLog)
    .where(eq(auditLog.id, first.id))
    .get()
  return row?.action === first.action && row.entityId === first.entityId && row.at === first.at
}

/**
 * Appends one audit entry inside an open transaction. Use it when one change needs several
 * entries (e.g. settlement per taker); otherwise prefer `withAudit`.
 */
export function writeAudit(tx: Tx, entry: AuditEntry): void {
  const holder = currentScope() ?? fallback
  const first = holder.first
  const changeId = first !== null && changeAlive(tx, first) ? first.id : null
  const at = (entry.at ?? new Date()).toISOString()
  const entityId = String(entry.entityId)
  const { id } = tx
    .insert(auditLog)
    .values({
      at,
      actorKind: entry.actor.kind,
      actorUserId: entry.actor.kind === 'user' ? entry.actor.userId : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
      changeId,
    })
    .returning({ id: auditLog.id })
    .get()
  if (changeId === null) {
    if (holder.first === null) {
      queueMicrotask(() => {
        holder.first = null
      })
    }
    holder.first = { id, action: entry.action, entityId, at }
  }
  for (const listener of listeners) {
    try {
      listener({ id, changeId })
    } catch (err) {
      console.error('[audit] write listener failed', err)
    }
  }
}

/**
 * Runs a state change and writes its audit entry (or entries) in the same transaction
 * (CLAUDE.md hard rule, spec §5.10). If the change or the audit write throws, both roll back.
 *
 * `change` gets the transaction and must do all its writes through it. `entry` is either a
 * fixed entry or built from the change's result (e.g. the new row's id).
 *
 * @example
 * const task = withAudit(
 *   db,
 *   (tx) => tx.insert(tasks).values(input).returning().get(),
 *   (task) => ({ actor, action: 'task.created', entityType: 'task', entityId: task.id, after: task }),
 * )
 */
export function withAudit<T>(
  db: Db,
  change: (tx: Tx) => NotAsync<T>,
  entry: AuditEntry | readonly AuditEntry[] | ((result: T) => AuditEntry | readonly AuditEntry[]),
): T {
  return db.transaction((tx) => {
    const result = change(tx)
    if ((result as unknown) instanceof Promise) {
      // Backstop for the type above. Throwing rolls back what ran so far, but writes after the
      // change's first `await` would still run later, outside any transaction: never pass an
      // async change.
      throw new TypeError('withAudit: the change must be synchronous')
    }
    const entries = typeof entry === 'function' ? entry(result) : entry
    const list: readonly AuditEntry[] = Array.isArray(entries) ? entries : [entries as AuditEntry]
    if (list.length === 0) throw new Error('withAudit: a state change needs at least one entry')
    for (const e of list) writeAudit(tx, e)
    return result
  })
}
