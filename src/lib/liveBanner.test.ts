import { describe, expect, it, vi } from 'vitest'
import { ALL_FEATURES, NO_FEATURES } from './features'
import {
  BANNER_START,
  bannerReduce,
  bannerText,
  dismissGuard,
  offersLiveRefresh,
  subsKey,
  subsOf,
} from './liveBanner'
import type { BannerEvent, BannerState } from './liveBanner'
import { cs } from './strings'

// The live change banner's count and text (#299, design "The banner").

const FREE = 'Starší · rezervace · Umýt okna v obýváku i v ložnici'

const change = (key: number, text = `Táta · změna ${String(key)}`): BannerEvent => ({
  type: 'change',
  event: { change: key, text },
})

const run = (...events: BannerEvent[]): BannerState => events.reduce(bannerReduce, BANNER_START)

describe('bannerReduce and bannerText', () => {
  it('no change: no banner', () => {
    expect(bannerText(BANNER_START)).toBeNull()
  })

  it("one change: that change's sentence; a second: Více změn (2)", () => {
    const one = run(change(1, FREE))
    expect(bannerText(one)).toBe(FREE)
    expect(bannerText(bannerReduce(one, change(2)))).toBe('Více změn (2)')
    expect(cs.live.banner.many(2)).toBe('Více změn (2)')
  })

  it('the same change key twice counts once', () => {
    expect(bannerText(run(change(1, FREE), change(1, 'other')))).toBe(FREE)
  })

  it('dismiss hides the banner but keeps the count; the next change shows Více změn (3)', () => {
    const dismissed = run(change(1), change(2), { type: 'dismiss' })
    expect(bannerText(dismissed)).toBeNull()
    expect(dismissed.changes.size).toBe(2)
    expect(bannerText(bannerReduce(dismissed, change(3)))).toBe('Více změn (3)')
  })

  it('after a dismiss, a replay of a counted key does not bring the banner back', () => {
    const s = run(change(1), { type: 'dismiss' }, change(1))
    expect(s.shown).toBe(false)
    expect(bannerText(s)).toBeNull()
  })

  it('overflow: Více změn (100+), also with later changes', () => {
    const s = run(change(1), { type: 'overflow' })
    expect(bannerText(s)).toBe('Více změn (100+)')
    expect(cs.live.banner.overflow).toBe('Více změn (100+)')
    expect(bannerText(bannerReduce(s, change(2)))).toBe('Více změn (100+)')
    expect(bannerText(run({ type: 'overflow' }))).toBe('Více změn (100+)')
  })

  it('overflow after a dismiss shows the banner again', () => {
    expect(bannerText(run(change(1), { type: 'dismiss' }, { type: 'overflow' }))).toBe(
      'Více změn (100+)',
    )
  })

  it('does not change the state it is given', () => {
    const one = run(change(1))
    bannerReduce(one, change(2))
    bannerReduce(one, { type: 'dismiss' })
    expect(one.changes.size).toBe(1)
    expect(one.shown).toBe(true)
    expect(BANNER_START).toEqual({
      changes: new Set(),
      text: null,
      overflow: false,
      shown: false,
    })
  })
})

describe('dismissGuard', () => {
  it("a swipe's onDismiss alone dispatches once", () => {
    const dismiss = vi.fn()
    const g = dismissGuard('k', () => 'k', dismiss)
    g.onDismiss()
    g.onDismiss()
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('onDismiss after the key changed: no dispatch', () => {
    const dismiss = vi.fn()
    let key = 'k'
    const g = dismissGuard('k', () => key, dismiss)
    key = 'other'
    g.onDismiss()
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('close() then onDismiss(): one dispatch', () => {
    const dismiss = vi.fn()
    const g = dismissGuard('k', () => 'k', dismiss)
    g.close()
    g.onDismiss()
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('drop() then onDismiss(): none', () => {
    const dismiss = vi.fn()
    const g = dismissGuard('k', () => 'k', dismiss)
    g.drop()
    g.onDismiss()
    g.close()
    expect(dismiss).not.toHaveBeenCalled()
  })
})

describe('subsOf and subsKey', () => {
  it('skips matches without live, non-arrays and malformed entries; keeps order; dedupes by token', () => {
    const subs = subsOf([
      {},
      { loaderData: undefined },
      { loaderData: { live: 'x' } },
      {
        loaderData: {
          live: [{ token: 'b', asOf: 2 }, { token: 3, asOf: 1 }, null, { token: 'z' }],
        },
      },
      { loaderData: { other: 1 } },
      {
        loaderData: {
          live: [
            { token: 'a', asOf: 1 },
            { token: 'b', asOf: 2 },
          ],
        },
      },
    ])
    expect(subs).toEqual([
      { token: 'b', asOf: 2 },
      { token: 'a', asOf: 1 },
    ])
    expect(subsKey(subs)).toBe('b a')
  })

  it('no subscriptions: the empty key', () => {
    expect(subsKey([])).toBe('')
    expect(subsOf([])).toEqual([])
  })
})

describe('offersLiveRefresh', () => {
  const live = [{ token: 'a', asOf: 1 }]
  it('only with the switch on and at least one subscription', () => {
    expect(offersLiveRefresh(NO_FEATURES, live)).toBe(false)
    expect(offersLiveRefresh(ALL_FEATURES, [])).toBe(false)
    expect(offersLiveRefresh(ALL_FEATURES, live)).toBe(true)
  })
})
