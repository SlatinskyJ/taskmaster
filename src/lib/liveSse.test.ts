import { describe, expect, it } from 'vitest'
import { createSseParser } from './liveSse'

// The tab's Server-Sent Events parser (#299): the stream's wire format, src/server/live/README.md.

describe('createSseParser', () => {
  it('a frame split across three chunks parses once', () => {
    const p = createSseParser()
    expect(p.push('id: 4\nda')).toEqual([])
    expect(p.push('ta: {"a":1}')).toEqual([])
    expect(p.push('\n\n')).toEqual([{ kind: 'event', id: '4', event: 'message', data: '{"a":1}' }])
    expect(p.push('')).toEqual([])
  })

  it('`: open` and `: ping` are comments', () => {
    const p = createSseParser()
    expect(p.push(': open\n\n: ping\n\n')).toEqual([
      { kind: 'comment', text: 'open' },
      { kind: 'comment', text: 'ping' },
    ])
  })

  it('`event: overflow` with `id: 7`', () => {
    const p = createSseParser()
    expect(p.push('id: 7\nevent: overflow\ndata: {}\n\n')).toEqual([
      { kind: 'event', id: '7', event: 'overflow', data: '{}' },
    ])
  })

  it('two frames in one chunk', () => {
    const p = createSseParser()
    expect(p.push('id: 1\ndata: a\n\nid: 2\ndata: b\n\n')).toEqual([
      { kind: 'event', id: '1', event: 'message', data: 'a' },
      { kind: 'event', id: '2', event: 'message', data: 'b' },
    ])
  })

  it('CRLF line ends, also split between chunks', () => {
    const p = createSseParser()
    expect(p.push(': open\r\n\r\nid: 3\r')).toEqual([{ kind: 'comment', text: 'open' }])
    expect(p.push('\ndata: x\r\n\r\n')).toEqual([
      { kind: 'event', id: '3', event: 'message', data: 'x' },
    ])
  })

  it('a frame without an id has id null; several data lines join with a newline', () => {
    const p = createSseParser()
    expect(p.push('event: replaced\ndata: a\ndata: b\n\n')).toEqual([
      { kind: 'event', id: null, event: 'replaced', data: 'a\nb' },
    ])
  })

  it('a value without the space after the colon, and blank lines alone, are fine', () => {
    const p = createSseParser()
    expect(p.push('\n\nid:5\ndata:{}\n\n:x\n')).toEqual([
      { kind: 'event', id: '5', event: 'message', data: '{}' },
      { kind: 'comment', text: 'x' },
    ])
  })

  it('the id and event of one frame do not carry into the next', () => {
    const p = createSseParser()
    expect(p.push('id: 1\nevent: overflow\ndata: {}\n\ndata: z\n\n')).toEqual([
      { kind: 'event', id: '1', event: 'overflow', data: '{}' },
      { kind: 'event', id: null, event: 'message', data: 'z' },
    ])
  })

  it('a frame with only an event or only an id still dispatches, with empty data', () => {
    const p = createSseParser()
    expect(p.push('event: replaced\n\nid: 3\n\n')).toEqual([
      { kind: 'event', id: null, event: 'replaced', data: '' },
      { kind: 'event', id: '3', event: 'message', data: '' },
    ])
  })

  it('a field name without a colon has an empty value; unknown fields are ignored', () => {
    const p = createSseParser()
    expect(p.push('retry: 10\ndata\ndata: a\n\n')).toEqual([
      { kind: 'event', id: null, event: 'message', data: '\na' },
    ])
  })
})
