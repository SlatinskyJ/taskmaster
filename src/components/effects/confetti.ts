import confetti from 'canvas-confetti'
import { effectsEnabled } from '~/lib/effects'

// Confetti burst (UI doc §4): about 2.4 s, in the state and accent colours of the current theme.

const COLOUR_TOKENS = [
  '--s-confirmed',
  '--s-open',
  '--s-pending',
  '--s-negotiating',
  '--s-proposed',
  '--accent',
]

/** ~2.4 s at 60 fps (canvas-confetti counts frames, called ticks). */
const TICKS = 144

function themeColours(): string[] {
  const style = getComputedStyle(document.documentElement)
  return COLOUR_TOKENS.map((t) => style.getPropertyValue(t).trim()).filter(Boolean)
}

/**
 * Bursts confetti from an element (a task row's Hotovo button), or from the top third of the
 * screen when none is given (level reached). Does nothing when effects are off.
 */
export function burstConfetti(from?: Element | null, size: 'small' | 'big' = 'small'): void {
  if (!effectsEnabled()) return
  let origin = { x: 0.5, y: 0.22 }
  if (from) {
    const r = from.getBoundingClientRect()
    origin = {
      x: (r.left + r.width / 2) / window.innerWidth,
      y: (r.top + r.height / 2) / window.innerHeight,
    }
  }
  void confetti({
    origin,
    particleCount: size === 'big' ? 150 : 50,
    spread: size === 'big' ? 100 : 70,
    startVelocity: size === 'big' ? 38 : 26,
    ticks: TICKS,
    gravity: 0.9,
    scalar: 0.9,
    colors: themeColours(),
    disableForReducedMotion: true,
  })
}
