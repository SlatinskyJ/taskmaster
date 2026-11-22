import { describe, expect, it } from 'vitest'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { rollPeriods } from '~/server/periods'
import { family } from '~/server/tasks/testing'
import {
  defaultsProposalApprovals,
  defaultsProposals,
  periodProposalApprovals,
  periodProposals,
} from './schema'

// Proposals for the next period and for the default week (spec §5.8). The partial unique
// indexes back up the domain's "one open proposal at a time".
const AT = '2026-11-22T12:00:00.000Z'

function setup() {
  const f = family()
  const [period] = rollPeriods(f.db, new Date(AT), DEFAULT_PERIOD_DEFAULTS)
  if (!period) throw new Error('no period')
  const periodRow = (status: string) => ({
    afterPeriodId: period.id,
    cutoffAt: '2026-12-06T22:59:00.000Z',
    lowerLevel: 60,
    upperLevel: 120,
    proposedBy: f.starsi,
    status,
    createdAt: AT,
  })
  const defaultsRow = (status: string) => ({
    lengthDays: 14,
    cutoffWeekday: 6,
    cutoffHour: 20,
    cutoffMinute: 0,
    lowerLevel: 60,
    upperLevel: 120,
    proposedBy: f.tata,
    status,
    createdAt: AT,
  })
  return { f, periodRow, defaultsRow }
}

describe('proposal tables', () => {
  it('one open per-period proposal per period', () => {
    const { f, periodRow } = setup()
    f.db.insert(periodProposals).values(periodRow('pending')).run()
    expect(() => f.db.insert(periodProposals).values(periodRow('agreed')).run()).toThrow(/UNIQUE/)
  })

  it('a closed one does not block a new one', () => {
    const { f, periodRow } = setup()
    f.db.insert(periodProposals).values(periodRow('rejected')).run()
    f.db.insert(periodProposals).values(periodRow('withdrawn')).run()
    f.db.insert(periodProposals).values(periodRow('pending')).run()
    expect(f.db.select().from(periodProposals).all()).toHaveLength(3)
  })

  it('one pending defaults proposal; an agreed one does not block', () => {
    const { f, defaultsRow } = setup()
    f.db.insert(defaultsProposals).values(defaultsRow('agreed')).run()
    f.db.insert(defaultsProposals).values(defaultsRow('pending')).run()
    expect(() => f.db.insert(defaultsProposals).values(defaultsRow('pending')).run()).toThrow(
      /UNIQUE/,
    )
  })

  it('status outside the list is refused', () => {
    const { f, periodRow, defaultsRow } = setup()
    expect(() => f.db.insert(periodProposals).values(periodRow('done')).run()).toThrow(
      /period_proposals_status_check/,
    )
    expect(() => f.db.insert(defaultsProposals).values(defaultsRow('lapsed')).run()).toThrow(
      /defaults_proposals_status_check/,
    )
  })

  it('levels and defaults are checked', () => {
    const { f, periodRow, defaultsRow } = setup()
    expect(() =>
      f.db
        .insert(periodProposals)
        .values({ ...periodRow('pending'), lowerLevel: 130 })
        .run(),
    ).toThrow(/period_proposals_levels_check/)
    expect(() =>
      f.db
        .insert(defaultsProposals)
        .values({ ...defaultsRow('pending'), lengthDays: 10 })
        .run(),
    ).toThrow(/defaults_proposals_length_check/)
  })

  it('approval twice by one user is refused', () => {
    const { f, periodRow, defaultsRow } = setup()
    const p = f.db.insert(periodProposals).values(periodRow('pending')).returning().get()
    const d = f.db.insert(defaultsProposals).values(defaultsRow('pending')).returning().get()
    const pa = { proposalId: p.id, userId: f.starsi, approvedAt: AT }
    f.db.insert(periodProposalApprovals).values(pa).run()
    expect(() => f.db.insert(periodProposalApprovals).values(pa).run()).toThrow(/UNIQUE/)
    const da = { proposalId: d.id, userId: f.tata, approvedAt: AT }
    f.db.insert(defaultsProposalApprovals).values(da).run()
    expect(() => f.db.insert(defaultsProposalApprovals).values(da).run()).toThrow(/UNIQUE/)
  })
})
