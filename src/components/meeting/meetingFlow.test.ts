import { describe, expect, it, vi } from 'vitest'
import type { SettleResult } from '~/server/settlement/functions'
import { pendingWeek, settledOk, week } from './fixtures'
import { afterConfirm, createConfirm, reduce, START, startingTotals, stepOf } from './meetingFlow'
import type { MeetingEvent, MeetingUi } from './meetingFlow'

const names = [
  { id: 3, name: 'Starší' },
  { id: 4, name: 'Mladší' },
]
const NEXT: MeetingEvent = { type: 'next', periodId: 1 }
const run = (events: MeetingEvent[], from: MeetingUi = START) => events.reduce(reduce, from)

describe('stepOf', () => {
  it('pending items show step 1, even after "Dál"', () => {
    expect(stepOf(pendingWeek(), START)).toBe(1)
    expect(stepOf(pendingWeek(), run([NEXT]))).toBe(1)
  })

  it('all clear stays on step 1 until "Dál: vyúčtovat", then step 2', () => {
    expect(stepOf(week(), START)).toBe(1)
    expect(stepOf(week(), run([NEXT]))).toBe(2)
  })

  it('nothing to settle shows step 3 only', () => {
    expect(stepOf({ period: null }, START)).toBe(3)
  })

  it('after a confirm the screen shows step 3 and never step 2', () => {
    const ui = run([NEXT, { type: 'ask' }, { type: 'sending' }])
    const done = reduce(ui, { type: 'answer', result: settledOk, names })
    // The reloaded meeting already offers the new week for step 2 (§5.8); the screen stays.
    expect(stepOf(week(), done)).toBe(3)
    expect(stepOf(pendingWeek(), done)).toBe(3)
    expect(stepOf({ period: null }, done)).toBe(3)
  })
})

describe('reduce', () => {
  it('Potvrdit asks, Vyúčtovat marks the call busy, the answer frees both', () => {
    const asked = run([NEXT, { type: 'ask' }])
    expect(asked).toEqual({ ...START, advanced: true, periodId: 1, asking: true })
    const sending = reduce(asked, { type: 'sending' })
    expect(sending).toEqual({ ...asked, busy: true })
    expect(reduce(sending, { type: 'answer', result: settledOk, names })).toEqual({
      advanced: true,
      periodId: 1,
      asking: false,
      busy: false,
      result: settledOk,
      names,
    })
  })
})

describe('another week after a reload starts at step 1 (ruling 2)', () => {
  const advanced = run([NEXT])
  const p = week().period
  if (!p) throw new Error('no week')
  const nextWeek = week({ period: { ...p, id: 2 } })

  it('the week was settled elsewhere (already_settled), the reload shows the new week', () => {
    const ui = reduce(advanced, {
      type: 'answer',
      result: { ok: false, error: 'already_settled' },
      names,
    })
    expect(stepOf(week(), ui)).toBe(2)
    expect(stepOf(nextWeek, ui)).toBe(1)
  })

  it('the answer was lost (failed), the reload shows the new week', () => {
    expect(stepOf(nextWeek, reduce(advanced, { type: 'failed' }))).toBe(1)
  })
})

describe('afterConfirm', () => {
  const calls = () => {
    const log: string[] = []
    return {
      log,
      ui: {
        success: (t: string) => log.push(`ok: ${t}`),
        error: (t: string) => log.push(`error: ${t}`),
        reload: () => {
          log.push('reload')
          return Promise.resolve()
        },
      },
    }
  }

  it.each([
    [settledOk, 'ok: Týden je vyúčtovaný'],
    [
      { ok: false, error: 'totals_changed' },
      'error: Mezitím se změnily body. Zkontroluj je a potvrď znovu.',
    ],
    [{ ok: false, error: 'pending_items' }, 'error: Přibylo něco ke schválení.'],
    [null, 'error: Vyúčtování se nepovedlo. Zkus to znovu.'],
  ] as [SettleResult | null, string][])('%j → toast, then reload', async (result, toast) => {
    const c = calls()
    await afterConfirm(result, c.ui)
    expect(c.log).toEqual([toast, 'reload'])
  })
})

describe('reduce on a refusal', () => {
  const asked = run([NEXT, { type: 'ask' }, { type: 'sending' }])
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

  it('a taker without a record is left out', () => {
    const ui = reduce(START, {
      type: 'answer',
      result: { ...settledOk, records: settledOk.records.slice(1) },
      names,
    })
    expect(startingTotals(ui)).toEqual([{ id: 3, name: 'Starší', carryOver: 30 }])
  })

  it('nothing before a confirm', () => {
    expect(startingTotals(START)).toEqual([])
  })
})
