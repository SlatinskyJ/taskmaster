/**
 * A `?redirect=` target after login, only if it is a path on this site: `/x` yes,
 * `//evil.example`, `/\evil.example` or `https://…` no (open redirect).
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) return undefined
  if (value.startsWith('//') || value.startsWith('/\\')) return undefined
  return value
}
