import { parseApproval } from '~/server/templates/parse'

// Input checks for the instance server functions: types and shape only.

/** Zapsat: the template and the score the taker was shown, both whole numbers. */
export function parseSelfLog(data: unknown): { templateId: number; score: number } {
  return parseApproval(data)
}
