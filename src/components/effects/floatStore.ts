import { effectsEnabled } from '~/lib/effects'

// The one "+N" on screen (UI doc §4), app-wide: the tap that starts it often unmounts its row,
// section or panel on the reload that follows, so the float lives here and FloatLayer shows it.

/** A "+N" to float over where the tapped button was, in screen coordinates. */
export interface PointsFloat {
  key: number
  points: number
  tone: 'pending' | 'confirmed'
  rect: { left: number; top: number; width: number; height: number }
}

let current: PointsFloat | null = null
let lastKey = 0
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

/**
 * Start a float; a fresh key re-mounts it, so a second tap plays again. With effects off
 * (Efekty switch or reduced motion) nothing is stored: it would never play, so never clear.
 */
export function showFloat(f: Omit<PointsFloat, 'key'>): void {
  if (!effectsEnabled()) return
  lastKey += 1
  current = { ...f, key: lastKey }
  notify()
}

/** Drop the float `key` once it has played; a newer float stays. */
export function clearFloat(key: number): void {
  if (current?.key !== key) return
  current = null
  notify()
}

export function currentFloat(): PointsFloat | null {
  return current
}

export function subscribeFloat(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
