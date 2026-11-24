import { describe, expect, it } from 'vitest'
import { item, week } from '~/components/week/fixtures'
import type { TaskView } from '~/server/tasks/functions'
import type { TemplateView } from '~/server/templates/functions'
import { recordDispute, taskDisputes, templateDispute, weekItemDispute } from './disputeProps'

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
