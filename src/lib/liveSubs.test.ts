import { describe, expect, it } from 'vitest'
import { liveSubs } from './liveSubs'
import { marker } from './liveSubs.testing'

describe('liveSubs', () => {
  it('take returns the data, in call order', () => {
    const live = liveSubs()
    expect(live.take({ data: 1, live: marker('a') })).toBe(1)
    expect(live.take({ data: 'x', live: null })).toBe('x')
    expect(live.take({ data: [2], live: marker('b') })).toEqual([2])
  })

  it('all() keeps the order and drops nulls', () => {
    const live = liveSubs()
    live.take({ data: 1, live: marker('b') })
    live.take({ data: 2, live: null })
    live.take({ data: 3, live: marker('a') })
    expect(live.all()).toEqual([marker('b'), marker('a')])
  })
})
