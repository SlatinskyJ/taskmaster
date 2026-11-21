import { describe, expect, it } from 'vitest'
import { auditLog } from '~/server/db/schema'
import { plus, reservedTask, SAT, week } from '~/server/settlement/testing'
import { completeTask, rejectTask } from './lifecycle'
import { rejectionsSince } from './rejections'
import { must } from './testing'

const H = 3_600_000

/** Starší does task `id` and Táta rejects it at `at`. */
function doneAndRejected(f: ReturnType<typeof week>, id: number, at: Date, reason?: string) {
  must(completeTask(f.db, f.starsi, id, plus(at, -60_000)))
  must(rejectTask(f.db, f.tata, id, reason, at))
}

describe('rejectionsSince', () => {
  it('reads each rejection back from its audit entry, newest first', () => {
    const f = week()
    const a = reservedTask(f, f.starsi, 7)
    const b = reservedTask(f, f.starsi, 4)
    doneAndRejected(f, a, plus(SAT, H), 'nádobí zůstalo v dřezu')
    doneAndRejected(f, b, plus(SAT, 2 * H))
    expect(rejectionsSince(f.db, SAT)).toEqual([
      {
        taskId: b,
        title: 'Vynést koš',
        score: 4,
        earnerId: f.starsi,
        at: plus(SAT, 2 * H).toISOString(),
        reason: null,
      },
      {
        taskId: a,
        title: 'Vynést koš',
        score: 7,
        earnerId: f.starsi,
        at: plus(SAT, H).toISOString(),
        reason: 'nádobí zůstalo v dřezu',
      },
    ])
  })

  it('includes a rejection exactly at since, not one a millisecond before', () => {
    const f = week()
    const a = reservedTask(f, f.starsi, 7)
    const b = reservedTask(f, f.starsi, 4)
    const since = plus(SAT, 5 * H)
    doneAndRejected(f, a, plus(since, -1))
    doneAndRejected(f, b, since)
    expect(rejectionsSince(f.db, since).map((r) => r.taskId)).toEqual([b])
  })

  it('skips an entry with no earner (none can be rejected today; kept safe for old rows)', () => {
    const f = week()
    const id = reservedTask(f, f.starsi, 7)
    f.db
      .insert(auditLog)
      .values({
        at: plus(SAT, H).toISOString(),
        actorKind: 'user',
        actorUserId: f.tata,
        action: 'task.rejected',
        entityType: 'task',
        entityId: String(id),
        before: JSON.stringify({ score: 7, earnerId: null }),
        after: null,
      })
      .run()
    expect(rejectionsSince(f.db, SAT)).toEqual([])
  })

  it('is empty with no rejections', () => {
    expect(rejectionsSince(week().db, SAT)).toEqual([])
  })
})
