import { parseIsoUtc, toPragueWallTime } from '~/domain/dates'

/**
 * A stored UTC instant as the Prague calendar day, `d. M. yyyy` (Czech style). The same on
 * the server (UTC) and in the browser, so the server render and hydration agree.
 */
export function formatPragueDate(iso: string): string {
  const { day, month, year } = toPragueWallTime(parseIsoUtc(iso))
  return `${String(day)}. ${String(month)}. ${String(year)}`
}
