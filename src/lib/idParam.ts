/** A task or template id from the URL: plain positive digits only, else null (→ not found). */
export function parseIdParam(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}
