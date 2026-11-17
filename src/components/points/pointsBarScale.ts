// Geometry of the points bar (UI doc §3). Pure, so the arithmetic is unit-tested.

/** [call] UI doc §3: the scale runs to 120 % of the upper level. */
export const SCALE_OVER_UPPER = 1.2

export interface PointsBarInput {
  confirmed: number
  pending: number
  lower: number
  upper: number
}

export interface PointsBarLayout {
  /** Width of the solid confirmed part, % of the bar. */
  confirmedPct: number
  /** Width of confirmed + pending (the striped part starts where confirmed ends), %. */
  totalPct: number
  lowerPct: number
  upperPct: number
  /** How each tick label hangs off its tick, so the two never overlap or leave the bar. */
  lowerLabel: LabelAlign
  upperLabel: LabelAlign
}

/** `center` on the tick, `end` = label ends at the tick, `start` = label starts at it. */
export type LabelAlign = 'start' | 'center' | 'end'

/** Below this gap (% of the bar) centred labels can collide on a 360 px phone. */
const LABEL_GAP_PCT = 30
/** A centred lower label this close to the left edge would stick out of the bar. */
const LABEL_EDGE_PCT = 10

const clampPct = (n: number) => Math.min(100, Math.max(0, n))

export function pointsBarLayout({
  confirmed,
  pending,
  lower,
  upper,
}: PointsBarInput): PointsBarLayout {
  // Points over 120 % of upper just fill the bar. A zero upper level (not valid per §5.8)
  // must not divide by zero.
  const max = Math.max(upper, lower, 1) * SCALE_OVER_UPPER
  const pct = (n: number) => clampPct((n / max) * 100)
  const c = Math.max(0, confirmed)
  const lowerPct = pct(lower)
  const upperPct = pct(upper)
  const close = upperPct - lowerPct < LABEL_GAP_PCT
  return {
    confirmedPct: pct(c),
    totalPct: pct(c + Math.max(0, pending)),
    lowerPct,
    upperPct,
    lowerLabel: close ? 'end' : lowerPct < LABEL_EDGE_PCT ? 'start' : 'center',
    upperLabel: close ? 'start' : 'center',
  }
}

export type LevelKey = 'lower' | 'upper'

/**
 * The highest level that confirmed points crossed, going from `before` to `after`
 * (UI doc §4 "Level reached"). Pending points never count: only confirmed ones do (§5.7).
 */
export function levelCrossed(
  before: number,
  after: number,
  levels: { lower: number; upper: number },
): LevelKey | null {
  if (after <= before) return null
  if (before < levels.upper && after >= levels.upper) return 'upper'
  if (before < levels.lower && after >= levels.lower) return 'lower'
  return null
}

/**
 * Remembers the last confirmed total a bar showed, for one subject (a taker in a period).
 * `next()` says which level to celebrate, if any. The first value and any change of subject
 * never celebrate: only a rise seen on screen does.
 */
export function createLevelWatcher(initialConfirmed: number, initialSubject: string) {
  let last = initialConfirmed
  let subject = initialSubject
  return {
    next(confirmed: number, levels: { lower: number; upper: number }, nextSubject: string) {
      if (nextSubject !== subject) {
        subject = nextSubject
        last = confirmed
        return null
      }
      const crossed = levelCrossed(last, confirmed, levels)
      last = confirmed
      return crossed
    },
  }
}
