/** One taker's points at one render, and whose they are (e.g. the user id). */
export interface PointsSnapshot {
  confirmed: number
  pending: number
  subject: string
}

/**
 * The "+N" to float on the points card (UI doc §4) when points went up since the last render:
 * green for confirmed points, the pending colour for points that wait for approval. The first
 * render and a change of subject never float.
 */
export function pointsDelta(
  prev: PointsSnapshot | null,
  next: PointsSnapshot,
): { points: number; tone: 'pending' | 'confirmed' } | null {
  if (prev?.subject !== next.subject) return null
  if (next.confirmed > prev.confirmed) {
    return { points: next.confirmed - prev.confirmed, tone: 'confirmed' }
  }
  if (next.pending > prev.pending) return { points: next.pending - prev.pending, tone: 'pending' }
  return null
}
