import { and, asc, eq, sql } from 'drizzle-orm'
import { lapsePeriodSettings } from '~/domain'
import type {
  DefaultsProposal,
  Period,
  PeriodProposalStatus,
  PeriodSettingsProposal,
} from '~/domain'
import { parseIsoUtc, toIsoUtc } from '~/domain/dates'
import type { Weekday } from '~/domain/dates'
import { writeAudit } from '~/server/audit'
import type { Tx } from '~/server/audit'
import type { Db } from '~/server/db'
import {
  defaultsProposalApprovals,
  periodProposalApprovals,
  periodProposals,
  periods,
} from '~/server/db/schema'
import type { DefaultsProposalRow, PeriodProposalRow, PeriodRow } from '~/server/db/schema'

// Proposal rows ↔ domain proposals, and the two things a period start does with them (spec
// §5.8): apply the agreed per-period change, lapse the pending ones. No import of defaults.ts or
// periods.ts, so periods.ts can use this without a cycle; the write paths are ./proposals.ts.

type Reader = Db | Tx

export type Stored<P> = P & { id: number }

const status = (s: string) => s as PeriodProposalStatus

function approvers(
  db: Reader,
  table: typeof periodProposalApprovals | typeof defaultsProposalApprovals,
  id: number,
): number[] {
  return db
    .select({ userId: table.userId })
    .from(table)
    .where(eq(table.proposalId, id))
    .orderBy(asc(table.approvedAt), sql`rowid`) // same instant: in the order they were written
    .all()
    .map((r) => r.userId)
}

export function toPeriodProposal(
  db: Reader,
  row: PeriodProposalRow,
): Stored<PeriodSettingsProposal> {
  return {
    id: row.id,
    afterPeriodId: row.afterPeriodId,
    settings: {
      cutoffAt: parseIsoUtc(row.cutoffAt),
      levels: { lower: row.lowerLevel, upper: row.upperLevel },
    },
    proposedBy: row.proposedBy,
    approvedBy: approvers(db, periodProposalApprovals, row.id),
    status: status(row.status),
    closedBy: row.closedBy,
  }
}

export function toDefaultsProposal(db: Reader, row: DefaultsProposalRow): Stored<DefaultsProposal> {
  return {
    id: row.id,
    settings: {
      lengthDays: row.lengthDays,
      cutoff: {
        weekday: row.cutoffWeekday as Weekday,
        hour: row.cutoffHour,
        minute: row.cutoffMinute,
      },
      levels: { lower: row.lowerLevel, upper: row.upperLevel },
    },
    proposedBy: row.proposedBy,
    approvedBy: approvers(db, defaultsProposalApprovals, row.id),
    status: status(row.status),
    closedBy: row.closedBy,
  }
}

/** The agreed change for the period after `periodId`, if any (at most one, by its index). */
export function agreedProposalFor(
  db: Reader,
  periodId: number,
): Stored<PeriodSettingsProposal> | null {
  const row = db
    .select()
    .from(periodProposals)
    .where(and(eq(periodProposals.afterPeriodId, periodId), eq(periodProposals.status, 'agreed')))
    .get()
  return row ? toPeriodProposal(db, row) : null
}

/**
 * Every pending per-period change whose period has started (the period it follows has ended by
 * `now`) lapses: it needed agreement before that start (spec §5.8). Audited by the system.
 */
export function lapseProposals(tx: Tx, now: Date): void {
  const pending = tx
    .select({ proposal: periodProposals, period: periods })
    .from(periodProposals)
    .innerJoin(periods, eq(periods.id, periodProposals.afterPeriodId))
    .where(eq(periodProposals.status, 'pending'))
    .all()
  for (const { proposal, period } of pending) {
    const before = toPeriodProposal(tx, proposal)
    if (lapsePeriodSettings(before, toPeriod(period), now).status !== 'lapsed') continue
    tx.update(periodProposals)
      .set({ status: 'lapsed', closedAt: toIsoUtc(now) })
      .where(eq(periodProposals.id, proposal.id))
      .run()
    writeAudit(tx, {
      actor: { kind: 'system' },
      action: 'period.proposal_lapsed',
      entityType: 'period_proposal',
      entityId: proposal.id,
      before: { status: 'pending' },
      after: { status: 'lapsed' },
      at: now,
    })
  }
}

/** A period row as the domain's `Period`. */
export function toPeriod(row: PeriodRow): Period {
  return {
    id: row.id,
    startsAt: parseIsoUtc(row.startsAt),
    cutoffAt: parseIsoUtc(row.cutoffAt),
    endedAt: row.endedAt === null ? null : parseIsoUtc(row.endedAt),
    levels: { lower: row.lowerLevel, upper: row.upperLevel },
  }
}
