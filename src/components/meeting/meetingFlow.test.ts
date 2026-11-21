import { describe, expect, it, vi } from 'vitest'
import type { SettleResult } from '~/server/settlement/functions'
import { pendingWeek, settledOk, week } from './fixtures'
import { createConfirm, reduce, START, startingTotals, stepOf } from './meetingFlow'
import type { MeetingEvent, MeetingUi } from './meetingFlow'

const names = [
  { id: 3, name: 'Starší' },
  { id: 4, name: 'Mladší' },
]
const run = (events: MeetingEvent[], from: MeetingUi = START) => events.reduce(reduce, from)

describe('stepOf', () => {
  it('pending items show step 1, even after "Dál"', () => {
    expect(stepOf(pendingWeek(), START)).toBe(1)
    expect(stepOf(pendingWeek(), run([{ type: 'next' }]))).toBe(1)
  })

  it('all clear stays on step 1 until "Dál: vyúčtovat", then step 2', () => {
    expect(stepOf(week(), START)).toBe(1)
    expect(stepOf(week(), run([{ type: 'next' }]))).toBe(2)
  })

  it('nothing to settle shows step 3 only', () => {
    expect(stepOf({ period: null }, START)).toBe(3)
  })

  it('after a confirm the screen shows step 3 and never step 2', () => {
    const ui = run([{ type: 'next' }, { type: 'ask' }, { type: 'sending' }])
    const done = reduce(ui, { type: 'answer', result: settledOk, names })
    // The reloaded meeting already offers the new week for step 2 (§5.8); the screen stays.
    expect(stepOf(week(), done)).toBe(3)
    expect(stepOf(pendingWeek(), done)).toBe(3)
    expect(stepOf({ period: null }, done)).toBe(3)
  })
})

describe('reduce on a refusal', () => {
  const asked = run([{ type: 'next' }, { type: 'ask' }, { type: 'sending' }])
  const refused = (error: string) =>
    reduce(asked, { type: 'answer', result: { ok: false, error } as SettleResult, names })

  it('totals_changed stays on step 2, closes the question, not busy', () => {
    const ui = refused('totals_changed')
    expect(stepOf(week(), ui)).toBe(2)
    expect(ui).toMatchObject({ asking: false, busy: false, result: null })
  })

  it('pending_items goes back to step 1', () => {
    const ui = refused('pending_items')
    expect(stepOf(week(), ui)).toBe(1)
  })

  it('a failed call closes the question and frees the button', () => {
    expect(reduce(asked, { type: 'failed' })).toMatchObject({ asking: false, busy: false })
  })

  it('Zpět closes the question without sending', () => {
    expect(run([{ type: 'ask' }, { type: 'back' }])).toEqual(START)
  })
})

describe('createConfirm', () => {
  it('sends exactly the shown totals of the shown week', async () => {
    const send = vi.fn(() => Promise.resolve(settledOk as SettleResult))
    await createConfirm(send, vi.fn(), vi.fn())(week())
    expect(send).toHaveBeenCalledWith({
      data: {
        periodId: 1,
        shown: [
          { takerId: 3, total: 130 },
          { takerId: 4, total: 47 },
        ],
      },
    })
  })

  it('totals_changed: the next confirm sends the reloaded totals', async () => {
    const send = vi.fn(() =>
      Promise.resolve({ ok: false, error: 'totals_changed' } as SettleResult),
    )
    const confirm = createConfirm(send, vi.fn(), vi.fn())
    await confirm(week())
    const t = week()
    if (!t.period) throw new Error('no week')
    await confirm({ ...t, takers: t.takers.map((x) => ({ ...x, total: x.total + 2 })) })
    expect(send).toHaveBeenLastCalledWith({
      data: {
        periodId: 1,
        shown: [
          { takerId: 3, total: 132 },
          { takerId: 4, total: 49 },
        ],
      },
    })
  })

  it('confirm runs once while a call is on its way', async () => {
    let answer: (r: SettleResult) => void = () => undefined
    const send = vi.fn(
      () =>
        new Promise<SettleResult>((resolve) => {
          answer = resolve
        }),
    )
    const confirm = createConfirm(send, vi.fn(), vi.fn())
    const first = confirm(week())
    void confirm(week())
    void confirm(week())
    answer(settledOk)
    await first
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('reports the answer with the names shown, then toasts and reloads', async () => {
    const dispatch = vi.fn()
    const after = vi.fn()
    await createConfirm(() => Promise.resolve(settledOk as SettleResult), dispatch, after)(week())
    expect(dispatch.mock.calls.map(([e]) => (e as MeetingEvent).type)).toEqual([
      'sending',
      'answer',
    ])
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'answer', result: settledOk, names })
    expect(after).toHaveBeenCalledWith(settledOk)
  })

  it('a call that throws reports a failure and tells the screen', async () => {
    const dispatch = vi.fn()
    const after = vi.fn()
    await createConfirm(() => Promise.reject(new Error('offline')), dispatch, after)(week())
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'failed' })
    expect(after).toHaveBeenCalledWith(null)
  })

  it('nothing to settle sends nothing', async () => {
    const send = vi.fn()
    await createConfirm(send, vi.fn(), vi.fn())({ period: null })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('startingTotals', () => {
  it("matches each taker's carry-over by id, in screen order", () => {
    const ui = reduce(START, { type: 'answer', result: settledOk, names })
    expect(startingTotals(ui)).toEqual([
      { id: 3, name: 'Starší', carryOver: 30 },
      { id: 4, name: 'Mladší', carryOver: 47 },
    ])
  })

  it('nothing before a confirm', () => {
    expect(startingTotals(START)).toEqual([])
  })
})
