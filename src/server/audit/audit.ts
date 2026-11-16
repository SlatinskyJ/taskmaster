import type { Db } from '~/server/db'
import { auditLog } from '~/server/db/schema'
import type { AuditAction, EntityType } from './actions'

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
const CREDENTIAL_KEY = /password|passwd|secret|token|^pin$|pin_?hash|credential|private_?key/i
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

/**
 * Appends one audit entry inside an open transaction. Use it when one change needs several
 * entries (e.g. settlement per taker); otherwise prefer `withAudit`.
 */
export function writeAudit(tx: Tx, entry: AuditEntry): void {
  tx.insert(auditLog)
    .values({
      at: (entry.at ?? new Date()).toISOString(),
      actorKind: entry.actor.kind,
      actorUserId: entry.actor.kind === 'user' ? entry.actor.userId : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: String(entry.entityId),
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
    })
    .run()
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
