import type { Meeting, SettleResult } from '~/server/settlement/functions'
import type { TaskView } from '~/server/tasks/functions'

// Test data for the meeting screen tests. Not imported by app code.

export const task = (over: Partial<TaskView>): TaskView => ({
  planDay: null,
  id: 1,
  title: 'Vyndat myčku',
  description: null,
  status: 'done_unconfirmed',
  score: 2,
  approvalRequired: true,
  createdByName: 'Táta',
  offeredByName: null,
  approvedBy: [],
  approverIds: [],
  bids: [],
  lowest: null,
  lastBids: [],
  reservedBy: { id: 3, name: 'Starší' },
  completedBy: { id: 3, name: 'Starší' },
  completedAt: '2026-11-28T10:00:00.000Z',
  earnerId: 3,
  origin: 'one_time',
  templateId: null,
  dueAt: null,
  graceEndsAt: null,
  createdAt: '2026-11-17T10:00:00.000Z',
  waitingFor: [],
  scoreChange: null,
  rebidding: null,
  ...over,
})

/** P1, 22. 11. – 29. 11. (ends at the meeting, Sun 20:00 Prague), levels 50/100. */
export const period = {
  id: 1,
  startsAt: '2026-11-21T23:00:00.000Z',
  endsAt: '2026-11-29T19:00:00.000Z',
  cutoffAt: '2026-11-29T22:59:00.000Z',
  running: true,
  levels: { lower: 50, upper: 100 },
}

/** Starší 130 (upper), Mladší 47 (none, 3 short). */
export const takers = [
  { id: 3, name: 'Starší', total: 130, level: 'upper' as const, deducted: 100, carryOver: 30 },
  { id: 4, name: 'Mladší', total: 47, level: 'none' as const, deducted: 0, carryOver: 47 },
]

export const week = (over: Partial<Extract<Meeting, { period: object }>> = {}): Meeting => ({
  period,
  pending: [],
  takers,
  ...over,
})

export const pendingWeek = (): Meeting =>
  week({
    pending: [
      task({ id: 11, title: 'Vyluxovat celý obývák a chodbu', score: 3 }),
      task({ id: 12, title: 'Zalít kytky', score: 2 }),
    ],
  })

/** A confirm's answer, records in the opposite order of the takers. */
export const settledOk: Extract<SettleResult, { ok: true }> = {
  ok: true,
  records: [
    { takerId: 4, totalBefore: 47, level: 'none', deducted: 0, carryOver: 47 },
    { takerId: 3, totalBefore: 130, level: 'upper', deducted: 100, carryOver: 30 },
  ],
  settledAt: '2026-11-29T19:00:00.000Z',
  next: {
    id: 2,
    startsAt: '2026-11-29T19:00:00.000Z',
    cutoffAt: '2026-12-06T22:59:00.000Z',
    levels: { lower: 50, upper: 100 },
  },
}
