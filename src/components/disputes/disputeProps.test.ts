import { describe, expect, it } from 'vitest'
import { item, week } from '~/components/week/fixtures'
import type { TaskView } from '~/server/tasks/functions'
import type { TemplateView } from '~/server/templates/functions'
import { weekLabel } from '~/components/period/periodView'
import {
  adjustmentDispute,
  adminDisputeLines,
  recordDispute,
  taskDisputes,
  templateDispute,
  weekItemDispute,
} from './disputeProps'

// What each Rozporovat names (#46): the exact item the server gets, and the drawer's text.

describe('weekItemDispute', () => {
  it('a confirmed item names its completion; the giver view carries the boy', () => {
    const p = weekItemDispute(item(), 'Starší')
    expect(p?.item).toEqual({ kind: 'completion', id: 10 })
    expect(p?.what).toBe('Potvrzené splnění')
    expect(p?.name).toBe('Vyluxovat celý obývák a chodbu')
    expect(p?.value).toBe('Starší · Vyluxovat celý obývák a chodbu · 8 bodů')
  })

  it('a rejected item names its audit entry, not the task', () => {
    const p = weekItemDispute(
      item({
        taskId: 12,
        status: 'rejected',
        dispute: { item: { kind: 'rejection', id: 90 }, mark: null },
      }),
      null,
    )
    expect(p?.item).toEqual({ kind: 'rejection', id: 90 })
    expect(p?.what).toBe('Zamítnuté splnění')
    expect(p?.value).toBe('Vyluxovat celý obývák a chodbu · 8 bodů')
  })

  it('a waiting item has none', () => {
    expect(
      weekItemDispute(item({ status: 'done_unconfirmed', dispute: undefined }), null),
    ).toBeNull()
  })
})

describe('recordDispute', () => {
  const w = week().history[0]
  const r = w?.records[0]
  if (!w || !r) throw new Error('fixture')
  it('names the settlement record, with the week and the numbers', () => {
    const p = recordDispute(w, r, true)
    expect(p.item).toEqual({ kind: 'settlement', id: 21 })
    expect(p.what).toBe('Vyúčtování týdne')
    expect(p.name).toBe('14. 11. – 21. 11.')
    expect(p.value).toBe('Starší · 14. 11. – 21. 11. · Celkem 108 · odečteno 100 · převod 8')
  })
  it('a taker view has no name', () => {
    expect(recordDispute(w, r, false).value).toBe(
      '14. 11. – 21. 11. · Celkem 108 · odečteno 100 · převod 8',
    )
  })
  it('a corrected record names its value as corrected (#48)', () => {
    const c = { ...r, correction: { level: 'lower' as const, deducted: 50, reason: 'x', at: '' } }
    expect(recordDispute(w, c, false).value).toBe(
      '14. 11. – 21. 11. · Spodní hranice · odečteno 50',
    )
  })
})

describe('adjustmentDispute (#48)', () => {
  const manual = {
    id: 31,
    points: -3,
    reason: 'Rozbitý hrnek.',
    at: '2026-11-25T10:00:00.000Z',
    fromWeek: null,
    waiting: false,
    dispute: { item: { kind: 'adjustment' as const, id: 31 }, mark: null },
  }
  it('names the adjustment itself, with the reason and the signed points', () => {
    expect(adjustmentDispute(manual, 'Starší')).toEqual({
      item: { kind: 'adjustment', id: 31 },
      what: 'Úprava bodů',
      value: 'Starší · Rozbitý hrnek. · −3 body',
      name: 'Úprava od správce',
    })
    expect(adjustmentDispute(manual, null)?.value).toBe('Rozbitý hrnek. · −3 body')
  })
  it('one from a correction is disputed via its settlement: none here', () => {
    const fromWeek = { startsAt: '2026-11-14T19:00:00.000Z', endsAt: '2026-11-21T19:00:00.000Z' }
    expect(adjustmentDispute({ ...manual, fromWeek, dispute: null }, null)).toBeNull()
  })
})

const task = (over: Partial<TaskView>): TaskView =>
  ({
    id: 7,
    title: 'Vysát auto',
    status: 'open',
    score: 6,
    completedBy: null,
    earnerId: null,
    origin: 'one_time',
    ...over,
  }) as TaskView

describe('taskDisputes', () => {
  it('an agreed task: the score only', () => {
    const ps = taskDisputes(task({ status: 'reserved' }), true)
    expect(ps.map((p) => p.item)).toEqual([{ kind: 'task_score', id: 7 }])
    expect(ps[0]?.what).toBe('Body za úkol')
    expect(ps[0]?.value).toBe('Vysát auto · 6 bodů')
  })

  it('a confirmed task: the score and the completion, with the earner for a giver', () => {
    const t = task({ status: 'confirmed', completedBy: { id: 3, name: 'Starší' }, earnerId: 3 })
    const ps = taskDisputes(t, true)
    expect(ps.map((p) => p.item)).toEqual([
      { kind: 'task_score', id: 7 },
      { kind: 'completion', id: 7 },
    ])
    expect(ps[1]?.value).toBe('Starší · Vysát auto · 6 bodů')
    expect(taskDisputes(t, false)[1]?.value).toBe('Vysát auto · 6 bodů')
  })

  it('a recurring copy: no score line (disputed on its template), its completion still has one', () => {
    const t = task({ status: 'confirmed', origin: 'on_demand', templateId: 4, earnerId: 3 })
    expect(taskDisputes(t, true).map((p) => p.item)).toEqual([{ kind: 'completion', id: 7 }])
    expect(taskDisputes(task({ status: 'reserved', origin: 'scheduled' }), true)).toEqual([])
  })

  it.each(['proposed', 'cancelled', 'expired'] as const)('%s: none', (status) => {
    expect(taskDisputes(task({ status }), true)).toEqual([])
  })
})

describe('templateDispute', () => {
  const t = { id: 4, title: 'Vynést koš', status: 'active', score: 2 } as TemplateView
  it('an active template names its score', () => {
    const p = templateDispute(t)
    expect(p?.item).toEqual({ kind: 'template_score', id: 4 })
    expect(p?.what).toBe('Body za opakovaný úkol')
    expect(p?.value).toBe('Vynést koš · 2 body')
  })
  it('a proposed one has none', () => {
    expect(templateDispute({ ...t, status: 'proposed' })).toBeNull()
  })
})

describe('adminDisputeLines (#47)', () => {
  const base = {
    id: 1,
    title: 'Vyluxovat celý obývák a chodbu',
    week: null,
    takerName: null,
    openedByName: 'Starší',
    reason: 'Bylo toho víc.',
    openedAt: '2026-11-22T23:30:00.000Z',
    takerId: null,
    page: null,
    weekPage: null,
  }

  it('a task score: what, title and points; opened by and the Prague date', () => {
    expect(
      adminDisputeLines({ ...base, item: { kind: 'task_score', id: 3 }, value: { score: 30 } }),
    ).toEqual({
      what: 'Body za úkol',
      value: 'Vyluxovat celý obývák a chodbu · 30 bodů',
      opened: 'Starší rozporuje · 23. 11.',
      reason: 'Bylo toho víc.',
      name: 'Vyluxovat celý obývák a chodbu',
    })
  })

  it('a completion names its boy', () => {
    const l = adminDisputeLines({
      ...base,
      item: { kind: 'completion', id: 3 },
      takerName: 'Starší',
      value: { score: 8 },
    })
    expect(l.what).toBe('Potvrzené splnění · Starší')
  })

  it('a settlement: week, level and deduction', () => {
    const week = { startsAt: '2026-11-15T23:00:00.000Z', endsAt: '2026-11-22T22:59:00.000Z' }
    const l = adminDisputeLines({
      ...base,
      title: '',
      week,
      item: { kind: 'settlement', id: 4 },
      takerName: 'Mladší',
      value: { level: 'lower', deducted: 50 },
    })
    expect(l.what).toBe('Vyúčtování týdne · Mladší')
    expect(l.value).toBe(`${weekLabel(week.startsAt, week.endsAt)} · Spodní hranice · odečteno 50`)
    expect(l.name).toBe(weekLabel(week.startsAt, week.endsAt))
  })

  it('an adjustment (#48): its reason names it, its points carry a sign', () => {
    const plus = adminDisputeLines({
      ...base,
      title: 'Pomoc s nákupem.',
      item: { kind: 'adjustment', id: 6 },
      takerName: 'Starší',
      value: { points: 5 },
    })
    expect(plus).toMatchObject({
      what: 'Úprava bodů · Starší',
      value: 'Pomoc s nákupem. · +5 bodů',
      name: 'Pomoc s nákupem.',
    })
    const minus = adminDisputeLines({
      ...base,
      title: 'Rozbitý hrnek.',
      item: { kind: 'adjustment', id: 7 },
      takerName: 'Starší',
      value: { points: -3 },
    })
    expect(minus.value).toBe('Rozbitý hrnek. · −3 body')
  })

  it('no value: only the title', () => {
    expect(
      adminDisputeLines({ ...base, item: { kind: 'task_score', id: 3 }, value: null }).value,
    ).toBe('Vyluxovat celý obývák a chodbu')
  })
})
