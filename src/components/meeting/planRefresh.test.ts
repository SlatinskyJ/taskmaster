import { describe, expect, it, vi } from 'vitest'
import { planFixture } from '~/components/week/fixtures'
import type { PlanAnswer } from '~/server/instances/functions'
import {
  createRefresh,
  meetingPlanView,
  REFRESH_START,
  refreshReduce,
  refreshTap,
  refreshView,
} from './planRefresh'
import type { RefreshEvent, RefreshState } from './planRefresh'

// The Obnovit button's state (#259): which plan the meeting's step 3 draws.

const a = planFixture()
const b = planFixture()
const c = planFixture()
const off: PlanAnswer = { error: 'feature_off' }

const run = (...events: RefreshEvent[]): RefreshState => events.reduce(refreshReduce, REFRESH_START)

describe('refreshReduce and refreshView', () => {
  it('before any refresh the loader plan shows', () => {
    expect(refreshView(REFRESH_START, a)).toEqual({ plan: a, busy: false, failed: false })
    expect(refreshView(REFRESH_START, a).plan).toBe(a)
  })

  it('an answer replaces the plan', () => {
    const s = run({ type: 'sending', base: a }, { type: 'answer', base: a, plan: b })
    const view = refreshView(s, a)
    expect(view.plan).toBe(b)
    expect(view.busy).toBe(false)
    expect(view.failed).toBe(false)
  })

  it('busy while the request is on its way', () => {
    const view = refreshView(run({ type: 'sending', base: a }), a)
    expect(view.plan).toBe(a)
    expect(view.busy).toBe(true)
  })

  it('drops an answer started from an older loader plan', () => {
    const s = run({ type: 'sending', base: a }, { type: 'answer', base: a, plan: b })
    // The route reloaded meanwhile: the loader now gives c.
    const view = refreshView(s, c)
    expect(view.plan).toBe(c)
    expect(view.busy).toBe(false)
  })

  it('an answer for another base than the state holds is dropped, busy still cleared', () => {
    const s = run({ type: 'sending', base: c }, { type: 'answer', base: a, plan: b })
    expect(s.busy).toBe(false)
    expect(refreshView(s, c).plan).toBe(c)
    const f = run({ type: 'sending', base: c }, { type: 'failed', base: a })
    expect(f.busy).toBe(false)
    expect(f.failed).toBe(false)
  })

  it('a newer loader plan wins over an earlier refresh', () => {
    const s = run({ type: 'sending', base: a }, { type: 'answer', base: a, plan: b })
    expect(refreshView(s, c)).toEqual({ plan: c, busy: false, failed: false })
    expect(refreshView(s, c).plan).toBe(c)
  })

  it('sending keeps plan when base is unchanged', () => {
    const s = run(
      { type: 'sending', base: a },
      { type: 'answer', base: a, plan: b },
      { type: 'sending', base: a },
    )
    const view = refreshView(s, a)
    expect(view).toEqual({ plan: b, busy: true, failed: false })
    expect(view.plan).toBe(b)
    const other = run(
      { type: 'sending', base: a },
      { type: 'answer', base: a, plan: b },
      { type: 'sending', base: c },
    )
    expect(refreshView(other, c).plan).toBe(c)
    expect(other.plan).toBeNull()
  })

  it('failed keeps the table and sets failed; a following sending clears it', () => {
    const s = run(
      { type: 'sending', base: a },
      { type: 'answer', base: a, plan: b },
      { type: 'sending', base: a },
      { type: 'failed', base: a },
    )
    const view = refreshView(s, a)
    expect(view.plan).toBe(b)
    expect(view).toEqual({ plan: b, busy: false, failed: true })
    const again = refreshReduce(s, { type: 'sending', base: a })
    expect(refreshView(again, a)).toEqual({ plan: b, busy: true, failed: false })
  })

  it('a failed refresh does not show once the loader plan changed', () => {
    const s = run({ type: 'sending', base: a }, { type: 'failed', base: a })
    expect(refreshView(s, c)).toEqual({ plan: c, busy: false, failed: false })
  })
})

describe('createRefresh', () => {
  it('a second refresh while one is on its way does nothing', async () => {
    let resolve: (p: PlanAnswer) => void = () => undefined
    const fetch = vi.fn(
      () =>
        new Promise<PlanAnswer>((r) => {
          resolve = r
        }),
    )
    const events: RefreshEvent[] = []
    const refresh = createRefresh(fetch, (e) => events.push(e))
    const first = refresh(a)
    await refresh(a)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(events).toEqual([{ type: 'sending', base: a }])
    resolve(b)
    await first
    expect(events).toEqual([
      { type: 'sending', base: a },
      { type: 'answer', base: a, plan: b },
    ])
    const third = refresh(a)
    expect(fetch).toHaveBeenCalledTimes(2)
    resolve(c)
    await third
  })

  it('a thrown fetch dispatches failed, and the next call fetches again', async () => {
    const fetch = vi.fn<() => Promise<PlanAnswer>>()
    fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(b)
    const events: RefreshEvent[] = []
    const refresh = createRefresh(fetch, (e) => events.push(e))
    await expect(refresh(a)).resolves.toBeUndefined()
    expect(events).toEqual([
      { type: 'sending', base: a },
      { type: 'failed', base: a },
    ])
    events.length = 0
    await refresh(a)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(events).toEqual([
      { type: 'sending', base: a },
      { type: 'answer', base: a, plan: b },
    ])
  })

  it('two consecutive taps: the second tap’s answer shows', async () => {
    let state = REFRESH_START
    const fetch = vi.fn<() => Promise<PlanAnswer>>()
    fetch.mockResolvedValueOnce(b).mockResolvedValueOnce(c)
    const refresh = createRefresh(fetch, (e) => {
      state = refreshReduce(state, e)
    })
    await refreshTap(refresh, a)()
    expect(refreshView(state, a).plan).toBe(b)
    await refreshTap(refresh, a)()
    expect(refreshView(state, a).plan).toBe(c)
    expect(refreshView(state, a).busy).toBe(false)
  })

  it('the tap sends the loader plan as base, never the plan on screen', async () => {
    const refresh = vi.fn(() => Promise.resolve())
    await refreshTap(refresh, a)()
    expect(refresh).toHaveBeenCalledWith(a)
  })
})

describe('meetingPlanView', () => {
  it('an Obnovit answered feature_off hides the block although the loader had a plan', () => {
    const s = run({ type: 'sending', base: a }, { type: 'answer', base: a, plan: off })
    expect(meetingPlanView(3, true, s, a).shown).toBe(false)
    const ok = run({ type: 'sending', base: a }, { type: 'answer', base: a, plan: b })
    const v = meetingPlanView(3, true, ok, a)
    expect(v.shown).toBe(true)
    expect(v.view?.plan).toBe(b)
  })

  it('no loader plan: no view, not shown', () => {
    expect(meetingPlanView(3, true, REFRESH_START, null)).toEqual({ view: null, shown: false })
  })

  it('not settled today or another step: not shown', () => {
    expect(meetingPlanView(3, false, REFRESH_START, a).shown).toBe(false)
    expect(meetingPlanView(1, true, REFRESH_START, a).shown).toBe(false)
  })
})
