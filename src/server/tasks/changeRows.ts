import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ScoreProposal } from '~/domain'
import { toIsoUtc } from '~/domain/dates'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import { taskScoreChangeApprovals, taskScoreChanges } from '~/server/db/schema'
import type { TaskScoreChangeRow } from '~/server/db/schema'

// Score changes of agreed one-time tasks (spec §5.2): reads and writes rows only. The rules
// live in src/domain/scoreChange.ts, the actions in ./scoreChange.

export type OpenChange = ScoreProposal & { id: number; createdAt: string }

/** The task's open score change with its approvals (oldest first, the proposer first), or null. */
export function openChangeOf(tx: Db | Tx, taskId: number): OpenChange | null {
  const change = tx
    .select()
    .from(taskScoreChanges)
    .where(and(eq(taskScoreChanges.taskId, taskId), isNull(taskScoreChanges.closedAt)))
    .get()
  if (!change) return null
  const approvedBy = tx
    .select({ userId: taskScoreChangeApprovals.userId })
    .from(taskScoreChangeApprovals)
    .where(eq(taskScoreChangeApprovals.changeId, change.id))
    .orderBy(asc(taskScoreChangeApprovals.approvedAt), asc(taskScoreChangeApprovals.userId))
    .all()
    .map((a) => a.userId)
  return {
    id: change.id,
    createdAt: change.createdAt,
    score: change.score,
    proposedBy: change.proposedBy,
    approvedBy,
  }
}

/** Starts a change, with the proposer's approval (proposing counts as approving, spec §3). */
export function insertChange(
  tx: Tx,
  taskId: number,
  proposedBy: number,
  score: number,
  now: Date,
): TaskScoreChangeRow {
  const at = toIsoUtc(now)
  const row = tx
    .insert(taskScoreChanges)
    .values({ taskId, score, proposedBy, createdAt: at })
    .returning()
    .get()
  insertApproval(tx, row.id, proposedBy, now)
  return row
}

export function insertApproval(tx: Tx, changeId: number, userId: number, now: Date): void {
  tx.insert(taskScoreChangeApprovals)
    .values({ changeId, userId, approvedAt: toIsoUtc(now) })
    .run()
}

/** Closes an open change. */
export function closeChange(
  tx: Tx,
  changeId: number,
  closedAs: NonNullable<TaskScoreChangeRow['closedAs']>,
  closedBy: number | null,
  now: Date,
): void {
  tx.update(taskScoreChanges)
    .set({ closedAt: toIsoUtc(now), closedAs, closedBy })
    .where(and(eq(taskScoreChanges.id, changeId), isNull(taskScoreChanges.closedAt)))
    .run()
}
