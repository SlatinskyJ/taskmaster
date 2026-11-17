import { useCallback, useSyncExternalStore } from 'react'

// Effects on/off (UI doc §4, the profile's "Efekty" switch, #31). On by default. Effects also
// stay off when the system asks for reduced motion; then only colours change.
// Stored on this device, like the theme (src/lib/theme.ts).

export const EFFECTS_STORAGE_KEY = 'tm-effects'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const listeners = new Set<() => void>()

function readSwitch(): boolean {
  try {
    return localStorage.getItem(EFFECTS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setEffectsSwitch(on: boolean): void {
  try {
    if (on) localStorage.removeItem(EFFECTS_STORAGE_KEY)
    else localStorage.setItem(EFFECTS_STORAGE_KEY, 'off')
  } catch {
    // Blocked storage: nothing to remember the choice in.
  }
  for (const listener of listeners) listener()
}

/** Calls `listener` when the switch or the system's reduced-motion setting changes. */
export function subscribeEffects(listener: () => void): () => void {
  listeners.add(listener)
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener('change', listener)
  return () => {
    listeners.delete(listener)
    media.removeEventListener('change', listener)
  }
}

/** True when effects may play right now: the switch is on and the system allows motion. */
export function effectsEnabled(): boolean {
  return readSwitch() && !window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** The profile switch: its state and a setter. Server render reads "on". */
export function useEffectsSwitch(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeEffects, readSwitch, () => true)
  const set = useCallback((next: boolean) => {
    setEffectsSwitch(next)
  }, [])
  return [on, set]
}

/** Whether components should animate. Server render reads "off", so nothing animates on load. */
export function useEffectsEnabled(): boolean {
  return useSyncExternalStore(subscribeEffects, effectsEnabled, () => false)
}
