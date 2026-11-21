import type { PointsFloat } from '~/components/effects/floatStore'

/**
 * The float for a successful action: `opts.float` points over the `opts.confetti` element,
 * green when they count at once (`confirmed`), else in the pending colour. Null without both.
 */
export function pointsFloat(
  result: object,
  opts: { confetti?: { getBoundingClientRect(): PointsFloat['rect'] } | null; float?: number },
): Omit<PointsFloat, 'key'> | null {
  if (opts.float === undefined || !opts.confetti) return null
  return {
    points: opts.float,
    tone: 'status' in result && result.status === 'confirmed' ? 'confirmed' : 'pending',
    rect: opts.confetti.getBoundingClientRect(),
  }
}
