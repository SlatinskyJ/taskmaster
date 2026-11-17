/**
 * A `?redirect=` target after login, only if it is a path on this site: `/x` yes,
 * `//evil.example`, `/\evil.example` or `https://…` no (open redirect). Control characters are
 * refused too: browsers drop tab and newline, so `/\t/evil.example` would become `//evil.example`.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/')) return undefined
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined
  if (value.startsWith('//') || value.startsWith('/\\')) return undefined
  return value
}
