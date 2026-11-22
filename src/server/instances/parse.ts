import { LOG_WHEN } from '~/domain/logTime'
import type { LogWhen } from '~/domain/logTime'

// Input checks for the instance server functions: types and shape only.

function invalid(): never {
  throw new Error('Invalid input')
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid()
  return value
}

/** Zapsat: the template and the score the taker was shown, and when ("now" if left out). */
export function parseSelfLog(data: unknown): { templateId: number; score: number; when: LogWhen } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) invalid()
  const { templateId, score, when = 'now' } = data as Record<string, unknown>
  if (!LOG_WHEN.some((w) => w === when)) invalid()
  return { templateId: int(templateId), score: int(score), when: when as LogWhen }
}
