import { normaliseDescription } from '~/domain'

// Input checks for descriptions (#207): types and a size cap only. Normalising and the
// 1000-character limit are the domain's (normaliseDescription), on the normalised text.

/** The most raw characters a description field may carry before normalising (a DoS cap). */
export const RAW_DESCRIPTION_MAX = 4000

function invalid(): never {
  throw new Error('Invalid input')
}

/** A description as sent: a string of at most RAW_DESCRIPTION_MAX characters. */
export function rawDescription(value: unknown): string {
  if (typeof value !== 'string' || value.length > RAW_DESCRIPTION_MAX) invalid()
  return value
}

/** An optional description on a create: missing → undefined. */
export function optionalDescription(body: Record<string, unknown>): string | undefined {
  return body.description === undefined ? undefined : rawDescription(body.description)
}

/**
 * The text a taker's page showed (ruling 8): a string, `null` for none, or missing (not
 * checked). Returned as an object to spread, so a missing field stays missing.
 */
export function seenDescriptionOf(body: Record<string, unknown>): {
  seenDescription?: string | null
} {
  const seen = body.seenDescription
  if (seen === undefined) return {}
  return { seenDescription: seen === null ? null : rawDescription(seen) }
}

/** Whether a create carries a description at all (blank or missing = none). */
export function hasDescription(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const text = normaliseDescription(raw)
  return !text.ok || text.value !== null
}
