import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { PeriodDefaults } from '~/domain'
import { featureFlags, periodProposals, defaultsProposals } from '~/server/db/schema'
import { CUTOFF, prague, week } from '~/server/settlement/testing'
import {
  approveProposalHandler,
  parsePeriodProposal,
  parseProposalRef,
  proposalsHandler,
  proposeDefaultsHandler,
  proposePeriodHandler,
  rejectProposalHandler,
  withdrawProposalHandler,
} from './proposalFunctions'

// The proposal server functions (#43): thin wrappers over ./proposals.ts behind the launch
// switch `periodProposals`. The handlers are exactly what the server functions run.

const AT = prague(2026, 11, 25, 12)
const CUT = prague(2026, 12, 5, 20).toISOString()
const DEFAULTS: PeriodDefaults = {
  lengthDays: 14,
  cutoff: { weekday: 6, hour: 20, minute: 0 },
  levels: { lower: 60, upper: 120 },
}

function on() {
  const f = week()
  f.db
    .update(featureFlags)
    .set({ enabled: true })
    .where(eq(featureFlags.key, 'periodProposals'))
    .run()
  return f
}

describe('parsePeriodProposal', () => {
  const good = { cutoffAt: CUT, levels: { lower: 60, upper: 120 } }

  it('takes exactly a cutoff instant and two levels', () => {
    expect(parsePeriodProposal(good)).toEqual({
      cutoffAt: new Date(CUT),
      levels: { lower: 60, upper: 120 },
    })
  })

  it('levels up to LEVEL_MAX: 999 accepted, 1000 refused', () => {
    expect(parsePeriodProposal({ ...good, levels: { lower: 1, upper: 999 } }).levels.upper).toBe(
      999,
    )
    expect(() => parsePeriodProposal({ ...good, levels: { lower: 1, upper: 1000 } })).toThrow()
  })

  it.each([
    ['extra key', { ...good, x: 1 }],
    ['not ISO', { ...good, cutoffAt: '5. 12. 2026' }],
    ['ISO without ms', { ...good, cutoffAt: '2026-12-05T19:00:00Z' }],
    ['fraction', { ...good, levels: { lower: 1.5, upper: 9 } }],
    ['string level', { ...good, levels: { lower: '1', upper: 9 } }],
    ['null', null],
  ])('refuses %s', (_name, data) => {
    expect(() => parsePeriodProposal(data)).toThrow()
  })
})

describe('parseProposalRef', () => {
  it('takes a kind and an id', () => {
    expect(parseProposalRef({ kind: 'defaults', id: 3 })).toEqual({ kind: 'defaults', id: 3 })
  })

  it.each([
    ['wrong kind', { kind: 'task', id: 1 }],
    ['fraction id', { kind: 'period', id: 1.5 }],
    ['extra key', { kind: 'period', id: 1, x: 1 }],
  ])('refuses %s', (_name, data) => {
    expect(() => parseProposalRef(data)).toThrow()
  })
})

describe('switch off', () => {
  it('every handler answers feature_off and writes nothing', () => {
    const f = week()
    const off = { ok: false, error: 'feature_off' }
    const settings = parsePeriodProposal({ cutoffAt: CUT, levels: { lower: 60, upper: 120 } })
    expect(proposalsHandler(f.db, AT)).toEqual({ error: 'feature_off' })
    expect(proposePeriodHandler(f.db, f.starsi, settings, AT)).toEqual(off)
    expect(proposeDefaultsHandler(f.db, f.tata, DEFAULTS, AT)).toEqual(off)
    const ref = { kind: 'period' as const, id: 1 }
    expect(approveProposalHandler(f.db, f.tata, ref, AT)).toEqual(off)
    expect(rejectProposalHandler(f.db, f.tata, ref, AT)).toEqual(off)
    expect(withdrawProposalHandler(f.db, f.tata, ref, AT)).toEqual(off)
    expect(f.db.select().from(periodProposals).all()).toEqual([])
    expect(f.db.select().from(defaultsProposals).all()).toEqual([])
  })
})

describe('switch on', () => {
  it('propose, approve, reject and withdraw return only id and status', () => {
    const f = on()
    const settings = parsePeriodProposal({ cutoffAt: CUT, levels: { lower: 60, upper: 120 } })
    expect(proposePeriodHandler(f.db, f.starsi, settings, AT)).toEqual({
      ok: true,
      status: 'pending',
    })
    const ref = { kind: 'period' as const, id: 1 }
    expect(approveProposalHandler(f.db, f.mladsi, ref, AT)).toEqual({ ok: true, status: 'pending' })
    expect(rejectProposalHandler(f.db, f.tata, ref, AT)).toEqual({ ok: true, status: 'rejected' })
    expect(withdrawProposalHandler(f.db, f.starsi, ref, AT)).toEqual({
      ok: false,
      error: 'not_pending',
    })
    expect(proposeDefaultsHandler(f.db, f.tata, DEFAULTS, AT)).toEqual({
      ok: true,
      status: 'pending',
    })
    expect(proposalsHandler(f.db, AT)).toMatchObject({ period: null, defaults: { id: 1 } })
  })

  it('a refusal is a result, not a throw', () => {
    const f = on()
    const settings = parsePeriodProposal({ cutoffAt: CUT, levels: { lower: 60, upper: 120 } })
    expect(proposePeriodHandler(f.db, f.starsi, settings, CUTOFF)).toEqual({
      ok: false,
      error: 'no_running_period',
    })
    expect(approveProposalHandler(f.db, f.tata, { kind: 'defaults', id: 9 }, AT)).toEqual({
      ok: false,
      error: 'not_found',
    })
  })
})
