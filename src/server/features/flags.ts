import type { FeatureKey, Features } from '~/lib/features'
import { FEATURE_KEYS, NO_FEATURES } from '~/lib/features'
import type { Db } from '~/server/db'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
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

/**
 * Turns the given switches on inside the caller's transaction, one `feature.switched` entry
 * each (#183). A switch already on writes nothing; a missing row is created. Only the demo
 * seed calls this (previews and e2e); production switches change by migration or by hand.
 */
export function switchOnIn(tx: Tx, keys: readonly FeatureKey[], at: Date): void {
  const now = getFlags(tx)
  for (const key of keys) {
    if (now[key]) continue
    tx.insert(featureFlags)
      .values({ key, enabled: true })
      .onConflictDoUpdate({ target: featureFlags.key, set: { enabled: true } })
      .run()
    writeAudit(tx, {
      actor: { kind: 'system' },
      action: 'feature.switched',
      entityType: 'feature',
      entityId: key,
      before: { enabled: false },
      after: { enabled: true },
      at,
    })
    now[key] = true
  }
}
