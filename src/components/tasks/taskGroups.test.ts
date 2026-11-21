import { describe, expect, it } from 'vitest'
import type { TaskView } from '~/server/tasks/functions'
import { GROUP_LABEL, GROUP_ORDER, groupTasks } from './taskGroups'

const t = (id: number, status: TaskView['status'], over: Partial<TaskView> = {}) =>
  ({ id, status, bids: [], ...over }) as TaskView

describe('Úkoly groups (UI doc §7.2 GTasks, #41)', () => {
  // GROUP_LABEL is a Record over every status (a new one fails to compile); the order must list
  // each of them once.
  it('has a group for every task status, so none drops out of the list', () => {
    expect([...GROUP_ORDER].sort()).toEqual(Object.keys(GROUP_LABEL).sort())
  })

  it('puts active states first and finished ones last, keeping the list order inside', () => {
    const list = [
      t(7, 'reserved'),
      t(6, 'confirmed'),
      t(5, 'open'),
      t(4, 'cancelled'),
      t(3, 'proposed', { bids: [{ takerId: 3, name: 'Starší', score: 20 }] }),
      t(2, 'done_unconfirmed'),
      t(1, 'open'),
    ]
    const groups = groupTasks(list)
    expect(groups.map((g) => [g.status, g.label, g.tasks.map((x) => x.id)])).toEqual([
      ['proposed', 'Návrhy a vyjednávání', [3]],
      ['open', 'Volné', [5, 1]],
      ['reserved', 'Rezervováno', [7]],
      ['done_unconfirmed', 'Čeká na potvrzení', [2]],
      ['confirmed', 'Hotovo', [6]],
      ['cancelled', 'Zrušeno', [4]],
    ])
  })

  it('shows no empty groups', () => {
    expect(groupTasks([])).toEqual([])
    expect(groupTasks([t(1, 'open')]).map((g) => g.status)).toEqual(['open'])
  })
})
