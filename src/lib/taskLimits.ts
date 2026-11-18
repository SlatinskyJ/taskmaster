/** Longest task name, in characters. Shared by the server's check and the Nový úkol form. */
export const TASK_TITLE_MAX = 80

/** A task or template name as stored: trimmed, inner spaces collapsed; null if blank or too long. */
export function normaliseTitle(title: string): string | null {
  const t = title.trim().replace(/\s+/g, ' ')
  return t.length > 0 && t.length <= TASK_TITLE_MAX ? t : null
}

/** Longest reason a giver can give when rejecting a completion. */
export const REASON_MAX = 200
