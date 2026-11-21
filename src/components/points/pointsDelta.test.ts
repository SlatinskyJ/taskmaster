import { describe, expect, it } from 'vitest'
import { pointsDelta } from './pointsDelta'

// The "+N" float on the points card (UI doc §4): what changed since the last render.
const at = (confirmed: number, pending: number, subject = '3') => ({ confirmed, pending, subject })

describe('pointsDelta', () => {
  it('stays quiet on the first render', () => {
    expect(pointsDelta(null, at(18, 5))).toBeNull()
  })
  it('floats the pending gain when a task is marked done', () => {
    expect(pointsDelta(at(0, 3), at(0, 15))).toEqual({ points: 12, tone: 'pending' })
  })
  it('floats the confirmed gain when a task is confirmed', () => {
    expect(pointsDelta(at(18, 12), at(30, 0))).toEqual({ points: 12, tone: 'confirmed' })
  })
  it('stays quiet when the taker changes', () => {
    expect(pointsDelta(at(0, 0, '3'), at(40, 12, '4'))).toBeNull()
  })
  it('stays quiet when nothing went up', () => {
    expect(pointsDelta(at(18, 12), at(18, 0))).toBeNull()
    expect(pointsDelta(at(18, 12), at(18, 12))).toBeNull()
  })
})
