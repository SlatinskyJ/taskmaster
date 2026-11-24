import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { sendFix } from './fixCalls'

// The one place the fix sheet reaches the server (#48).
const adjust = { takerId: 3, points: -5, reason: 'Rozbitý hrnek.', from: null }
const correct = { settlementId: 7, level: 'upper' as const, reason: 'Chyběl úkol.', from: null }
const okCall = () => vi.fn(() => Promise.resolve({ ok: true as const }))

describe('sendFix', () => {
  it('points: sends exactly { data } to adjust only and answers ok', async () => {
    const calls = { adjust: okCall(), correct: okCall() }
    await expect(sendFix(calls, { mode: 'points', input: adjust })).resolves.toEqual({ ok: true })
    expect(calls.adjust).toHaveBeenCalledWith({ data: adjust })
    expect(calls.correct).not.toHaveBeenCalled()
  })

  it('week: sends exactly { data } to correct only', async () => {
    const calls = { adjust: okCall(), correct: okCall() }
    await sendFix(calls, { mode: 'week', input: correct })
    expect(calls.correct).toHaveBeenCalledWith({ data: correct })
    expect(calls.adjust).not.toHaveBeenCalled()
  })

  it.each([
    ['value_changed', true],
    ['not_open', true],
    ['not_found', true],
    ['week_waiting', false],
    ['would_go_negative', false],
  ] as const)('%s: its message; reload %s', async (error, reload) => {
    const refuse = vi.fn(() => Promise.resolve({ ok: false as const, error }))
    const r = await sendFix(
      { adjust: refuse, correct: okCall() },
      { mode: 'points', input: adjust },
    )
    expect(r).toEqual({ ok: false, message: expect.any(String) as string, reload })
    expect(r.ok ? '' : r.message).not.toBe(cs.disputes.errors.generic)
  })

  it('a failed request: the generic message, no reload', async () => {
    const fail = vi.fn(() => Promise.reject(new Error('offline')))
    await expect(
      sendFix({ adjust: okCall(), correct: fail }, { mode: 'week', input: correct }),
    ).resolves.toEqual({ ok: false, message: cs.disputes.errors.generic, reload: false })
  })
})
