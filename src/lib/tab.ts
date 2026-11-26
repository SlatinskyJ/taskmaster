// This tab's id (#299): one per page load, kept in module memory. Every server function call
// sends it (src/start.ts, header `x-tm-tab`), and the live stream opens with it, so the hub
// does not echo a tab's own change back to that tab (src/server/live/README.md).

/** Header a tab's server function calls carry. */
export const TAB_HEADER = 'x-tm-tab'

let id: string | null = null

export function tabId(): string {
  id ??= crypto.randomUUID()
  return id
}
