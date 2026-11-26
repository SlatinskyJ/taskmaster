import type { FeatureKey, Features } from '~/lib/features'
import { FEATURE_KEYS, NO_FEATURES } from '~/lib/features'
import type { Db } from '~/server/db'
import { writeAudit } from '~/server/audit'
import type { Actor, Tx } from '~/server/audit'
import { featureFlags } from '~/server/db/schema'

function isFeatureKey(key: string): key is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(key)
}

/**
 * The launch switches as the database has them now. A switch with no row reads as off; a row
 * for a switch the code no longer knows is ignored.
 */
export function getFlags(db: Db | Tx): Features {
  const flags: Features = { ...NO_FEATURES }
  for (const row of db.select().from(featureFlags).all()) {
    if (isFeatureKey(row.key)) flags[row.key] = row.enabled
  }
  return flags
}

/** Stores one switch's new value and its `feature.switched` entry, inside the caller's transaction. */
function writeSwitch(
  tx: Tx,
  key: FeatureKey,
  before: boolean,
  enabled: boolean,
  actor: Actor,
  at: Date,
): void {
  tx.insert(featureFlags)
    .values({ key, enabled })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled } })
    .run()
  writeAudit(tx, {
    actor,
    action: 'feature.switched',
    entityType: 'feature',
    entityId: key,
    before: { enabled: before },
    after: { enabled },
    at,
  })
}

/**
 * Sets every switch inside the caller's transaction: the listed ones on, all others off, one
 * `feature.switched` entry per switch that changes (#183). A switch already as wanted writes
 * nothing; a missing row is created. Only the demo seed calls this (previews and e2e), so each
 * seed gets exactly its switches whatever the migrations turned on; production switches change
 * in Správa (`setSwitch`), by migration, or by hand.
 */
export function setSwitchesIn(tx: Tx, on: readonly FeatureKey[], at: Date): void {
  const now = getFlags(tx)
  for (const key of FEATURE_KEYS) {
    const enabled = on.includes(key)
    if (now[key] === enabled) continue
    writeSwitch(tx, key, now[key], enabled, { kind: 'system' }, at)
    now[key] = enabled
  }
}

/**
 * The admin turns one switch on or off in Správa (#296), audit-logged with the admin as actor
 * in the same transaction. A switch that already has that value writes nothing (a double tap,
 * two tabs) and reports `changed: false`; a switch with no row gets one.
 */
export function setSwitch(
  db: Db,
  adminId: number,
  key: FeatureKey,
  enabled: boolean,
  at: Date,
): { changed: boolean } {
  // Not `withAudit`: an unchanged switch writes no entry, and withAudit refuses an empty list.
  return db.transaction((tx) => {
    const before = getFlags(tx)[key]
    if (before === enabled) return { changed: false }
    writeSwitch(tx, key, before, enabled, { kind: 'user', userId: adminId }, at)
    return { changed: true }
  })
}

/** The input of `setSwitchFn`: a switch the code knows and a boolean. Anything else throws. */
export function parseSwitchInput(input: unknown): { key: FeatureKey; enabled: boolean } {
  if (typeof input !== 'object' || input === null) throw new Error('invalid_switch')
  const { key, enabled } = input as Record<string, unknown>
  if (typeof key !== 'string' || !isFeatureKey(key) || typeof enabled !== 'boolean') {
    throw new Error('invalid_switch')
  }
  return { key, enabled }
}
