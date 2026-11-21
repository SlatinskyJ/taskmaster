import { useEffect, useSyncExternalStore } from 'react'
import { FloatingPoints } from './FloatingPoints'
import { clearFloat, currentFloat, subscribeFloat } from './floatStore'

/**
 * The app-wide "+N" layer (UI doc §4), mounted once in the `_app` layout. It floats where the
 * tapped button was, fixed to the screen and above the bottom bar, so it outlives the row or
 * section the reload removes. A played float is cleared, and so is one left when the layout
 * unmounts (logout), so it never replays for the next person.
 */
export function FloatLayer() {
  const float = useSyncExternalStore(subscribeFloat, currentFloat, currentFloat)
  const key = float?.key
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
