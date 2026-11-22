import { MAX_LENGTH_DAYS } from '~/domain/periods'

// Limits for the default week (spec §5.8), shared by the admin card and the server's check.

/** [call] Highest level the admin can set: stops a typo like 10000, not a rule of the spec. */
export const LEVEL_MAX = 999

/** Longest default week, in weeks (the domain's bound in days). */
export const LENGTH_WEEKS_MAX = MAX_LENGTH_DAYS / 7
