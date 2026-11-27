import { describe, expect, it } from 'vitest'
import { createGauge, DEMO_STREAMS_PER_IP, demoStreamSlot, liveGauge } from './caps'

const openTimes = (g: ReturnType<typeof createGauge>, key: string, n: number) =>
  Array.from({ length: n }, () => g.open(key))

describe('createGauge', () => {
  it('opens up to the limit, refuses the next, and opens again after a close', () => {
    const g = createGauge(DEMO_STREAMS_PER_IP)
    expect(openTimes(g, 'a', 12).every(Boolean)).toBe(true)
    expect(g.open('a')).toBe(false)
    expect(g.open('b')).toBe(true)
    g.close('a')
    expect(g.open('a')).toBe(true)
    expect(g.open('a')).toBe(false)
  })

  it('a close on an unknown key stays at 0: a later full set still opens', () => {
    const g = createGauge(12)
    g.close('x')
    g.close('x')
    expect(openTimes(g, 'x', 12).every(Boolean)).toBe(true)
    expect(g.open('x')).toBe(false)
  })

  it('closing every place frees the key for a full set again', () => {
    const g = createGauge(2)
    openTimes(g, 'x', 2)
    g.close('x')
    g.close('x')
    g.close('x')
    expect(openTimes(g, 'x', 3)).toEqual([true, true, false])
  })

  it('a key back at 0 leaves the gauge, so it does not grow with every visitor', () => {
    const g = createGauge(2)
    openTimes(g, 'x', 2)
    g.open('y')
    g.close('x')
    expect(g.size()).toBe(2)
    g.close('x')
    g.close('y')
    expect(g.size()).toBe(0)
  })
})

describe('demoStreamSlot', () => {
  it('on the demo: a slot in the gauge under the IP', () => {
    const g = createGauge(1)
    const slot = demoStreamSlot({ TASKMASTER_ENV: 'demo' }, '203.0.113.9', g)
    expect(slot?.open()).toBe(true)
    expect(slot?.open()).toBe(false)
    expect(g.open('198.51.100.1')).toBe(true)
    slot?.close()
    expect(g.open('203.0.113.9')).toBe(true)
  })

  it('one IPv6 /64 shares one place, another /64 has its own', () => {
    const g = createGauge(1)
    const demo = { TASKMASTER_ENV: 'demo' }
    expect(demoStreamSlot(demo, '2001:db8:1:2::a', g)?.open()).toBe(true)
    expect(demoStreamSlot(demo, '2001:db8:1:2::b', g)?.open()).toBe(false)
    expect(demoStreamSlot(demo, '2001:db8:1:3::a', g)?.open()).toBe(true)
  })

  it('no slot on a preview, outside the demo, or on a demo flag with ADMIN_PASSWORD', () => {
    for (const env of [
      { TASKMASTER_ENV: 'preview' },
      {},
      { TASKMASTER_ENV: 'demo', ADMIN_PASSWORD: 'x' },
    ]) {
      expect(demoStreamSlot(env, '203.0.113.9')).toBeUndefined()
    }
  })

  it('defaults to the server gauge', () => {
    const slot = demoStreamSlot({ TASKMASTER_ENV: 'demo' }, 'gauge-default-test')
    expect(slot?.open()).toBe(true)
    slot?.close()
    expect(openTimes(liveGauge, 'gauge-default-test', 13).filter(Boolean)).toHaveLength(12)
  })
})
