// Input checks for the instance server functions: types and shape only.

function invalid(): never {
  throw new Error('Invalid input')
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid()
  return value
}

/** Zapsat: the template and the score the taker was shown, both whole numbers. */
export function parseSelfLog(data: unknown): { templateId: number; score: number } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) invalid()
  const { templateId, score } = data as Record<string, unknown>
  return { templateId: int(templateId), score: int(score) }
}
