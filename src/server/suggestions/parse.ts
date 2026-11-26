// Inputs of the suggestion server functions (./functions), checked for shape only: the text
// rules are the domain's. Unknown keys are dropped, so an author, a state or an issue link can
// never ride along. Any string over 10,000 characters is refused before cleaning (ruling 8).

const RAW_MAX = 10_000

function invalid(): never {
  throw new Error('Invalid input')
}

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) invalid()
  return data as Record<string, unknown>
}

function int(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) invalid()
  return value
}

function str(value: unknown): string {
  if (typeof value !== 'string' || value.length > RAW_MAX) invalid()
  return value
}

function move(value: unknown): 'done' | 'dismiss' {
  if (value !== 'done' && value !== 'dismiss') invalid()
  return value
}

export function parseNewSuggestion(data: unknown): { title: string; description: string } {
  const d = record(data)
  return { title: str(d.title), description: str(d.description) }
}

export function parseClose(data: unknown): { id: number; move: 'done' | 'dismiss' } {
  const d = record(data)
  return { id: int(d.id), move: move(d.move) }
}

export function parseSend(data: unknown): { id: number; title: string; body: string } {
  const d = record(data)
  return { id: int(d.id), title: str(d.title), body: str(d.body) }
}
