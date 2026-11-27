// A small Server-Sent Events parser for the live stream (#299): the tab reads `/api/live` with
// `fetch` (native EventSource gives up for good after a non-200, src/lib/liveConnect.ts), so it
// parses the body itself. Wire format: src/server/live/README.md "The stream".

export type SseFrame =
  | { kind: 'comment'; text: string }
  | { kind: 'event'; id: string | null; event: string; data: string }

export interface SseParser {
  /** Feeds decoded text; returns the frames it completed, in order. */
  push(chunk: string): SseFrame[]
}

export function createSseParser(): SseParser {
  let buffer = ''
  let id: string | null = null
  let event: string | null = null
  let data: string[] | null = null

  const field = (line: string): [string, string] => {
    const colon = line.indexOf(':')
    if (colon < 0) return [line, '']
    const value = line.slice(colon + 1)
    return [line.slice(0, colon), value.startsWith(' ') ? value.slice(1) : value]
  }

  return {
    push(chunk) {
      buffer += chunk
      const out: SseFrame[] = []
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const raw = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        nl = buffer.indexOf('\n')
        const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
        if (line === '') {
          if (data !== null || event !== null || id !== null) {
            out.push({
              kind: 'event',
              id,
              event: event ?? 'message',
              data: (data ?? []).join('\n'),
            })
          }
          id = null
          event = null
          data = null
          continue
        }
        const [name, value] = field(line)
        if (name === '') out.push({ kind: 'comment', text: value })
        else if (name === 'id') id = value
        else if (name === 'event') event = value
        else if (name === 'data') (data ??= []).push(value)
      }
      return out
    },
  }
}
