/** Longest reason for a dispute, after trimming (the DB checks it again, migrations 0023, 0025). */
export const DISPUTE_REASON_MAX = 1000

/** Longest note the admin leaves when closing a dispute, after trimming (#47). */
export const DISPUTE_NOTE_MAX = 1000

/** Longest reason for a settlement correction or a point adjustment, after trimming (#48). */
export const FIX_REASON_MAX = 1000

/** Largest point adjustment either way (#48): a guard against typos, the spec sets no limit. */
export const ADJUST_POINTS_MAX = 9999
