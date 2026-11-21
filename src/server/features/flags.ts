import type { Features } from '~/lib/features'
import { FEATURE_KEYS, NO_FEATURES } from '~/lib/features'
import type { Db } from '~/server/db'
import { featureFlags } from '~/server/db/schema'

function isFeatureKey(key: string): key is keyof Features {
  return (FEATURE_KEYS as readonly string[]).includes(key)
}

/**
 * The launch switches as the database has them now. A switch with no row reads as off; a row
 * for a switch the code no longer knows is ignored.
 */
export function getFlags(db: Db): Features {
  const flags: Features = { ...NO_FEATURES }
  for (const row of db.select().from(featureFlags).all()) {
    if (isFeatureKey(row.key)) flags[row.key] = row.enabled
  }
  return flags
}
