import { FEATURE_KEYS } from '~/lib/features'
import type { FeatureKey, Features } from '~/lib/features'
import { cs } from '~/lib/strings'

// Funkce on Správa (#296, spec §6): the rows and the confirm's copy. Pure, so it is unit-tested;
// FeaturesCard and the page hold the markup and the state.

const t = cs.admin.features

export interface SwitchRowData {
  key: FeatureKey
  name: string
  hint: string
  on: boolean
}

/** One row per switch the code knows (`FEATURE_KEYS`, in its order); one with no row reads off. */
export function switchRows(features: Features): SwitchRowData[] {
  return FEATURE_KEYS.map((key) => ({ key, ...t.names[key], on: features[key] }))
}

/** The confirm's title, body and button for turning `key` on or off. */
export function confirmCopy(
  key: FeatureKey,
  turnOn: boolean,
): { title: string; body: string; confirm: string } {
  const { name } = t.names[key]
  // Turning weekPlan off drops the copies' day rules on the next tick (src/server/features/README.md).
  const warn = key === 'weekPlan' && !turnOn
  return {
    title: turnOn ? t.turnOnTitle(name) : t.turnOffTitle(name),
    body: warn ? `${t.forFamily} ${t.weekPlanOff}` : t.forFamily,
    confirm: turnOn ? t.confirmOn : t.confirmOff,
  }
}

/** The loader's read: a failed fetch becomes the card's error state, the rest of Správa loads. */
export async function loadSwitches<T>(fetch: () => Promise<T>): Promise<T | { error: 'failed' }> {
  try {
    return await fetch()
  } catch {
    return { error: 'failed' }
  }
}
