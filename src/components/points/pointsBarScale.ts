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
}

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
  return {
    confirmedPct: pct(c),
    totalPct: pct(c + Math.max(0, pending)),
    lowerPct: pct(lower),
    upperPct: pct(upper),
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
