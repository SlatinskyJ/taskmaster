import type { LiveSub } from '~/server/live/functions'

/** A recognisable stand-in subscription for page tests: `{ token: name, asOf: 1 }`. */
export const marker = (name: string): LiveSub => ({ token: name, asOf: 1 })

/** A mocked data function's answer: the data with its marker. */
export const withMarker = <T>(name: string, data: T) => ({ data, live: marker(name) })
