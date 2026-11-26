import { clientCache } from '~/lib/clientCache'
import { getFeaturesFn } from '~/server/features/functions'

/** The launch switches change rarely: fetched once per page load (and again after an hour in an
 * app left open), not on every screen change. The server render always reads the database. */
export const loadFeatures = clientCache(() => getFeaturesFn(), 60 * 60 * 1000)

/** Drops the cached switches, so this browser's next navigation reads them fresh (Správa → Funkce
 * after a flip, #296). */
export function forgetFeatures(): void {
  loadFeatures.forget()
}
