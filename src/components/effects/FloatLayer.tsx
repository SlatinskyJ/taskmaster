import { useEffect, useSyncExternalStore } from 'react'
import { useEffectsEnabled } from '~/lib/effects'
import { FloatingPoints } from './FloatingPoints'
import { clearFloat, currentFloat, subscribeFloat } from './floatStore'

/**
 * The app-wide "+N" layer (UI doc §4), mounted once in the `_app` layout. It floats where the
 * tapped button was, fixed to the screen and above the bottom bar, so it outlives the row or
 * section the reload removes. A played float is cleared, and so is one left when the layout
 * unmounts (logout) or that came while effects were off, so it never replays later.
 */
export function FloatLayer() {
  const float = useSyncExternalStore(subscribeFloat, currentFloat, currentFloat)
  const enabled = useEffectsEnabled()
  const key = float?.key
  // With effects off nothing plays, so nothing would clear it: drop it at once, or it would
  // replay at the old place once effects are back on.
  useEffect(() => {
    if (!enabled && key !== undefined) clearFloat(key)
  }, [enabled, key])
  useEffect(
    () => () => {
      if (key !== undefined) clearFloat(key)
    },
    [key],
  )
  if (!float) return null
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-50"
      style={{
        left: float.rect.left,
        top: float.rect.top,
        width: float.rect.width,
        height: float.rect.height,
      }}
    >
      <FloatingPoints
        key={float.key}
        points={float.points}
        tone={float.tone}
        onDone={() => {
          clearFloat(float.key)
        }}
      />
    </div>
  )
}
