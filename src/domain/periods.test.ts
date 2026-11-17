import { describe, expect, it } from 'vitest'
import { fromPragueWallTime, toPragueWallTime } from './dates'
import type { Person } from './parties'
import type {
  DefaultsProposal,
  PeriodDefaults,
  PeriodError,
  PeriodSettingsProposal,
  PeriodSpan,
} from './periods'
import {
  DEFAULT_CUTOFF,
  DEFAULT_LENGTH_DAYS,
  approveDefaults,
  approvePeriodSettings,
  canSettle,
  defaultCutoff,
  firstPeriod,
  hasStarted,
  isPeriodAgreed,
  isValidDefaults,
  lapsePeriodSettings,
  nextPeriod,
  periodAt,
  periodsToStart,
  proposeDefaults,
  proposePeriodSettings,
  rejectPeriodProposal,
  resolvePeriodProposal,
  setDefaults,
  withdrawPeriodProposal,
} from './periods'
import type { Result } from './result'

const DAD = 1
const OLDER = 2
const YOUNGER = 3
const JAKUB = 4
const MUM = 5
const family: Person[] = [
  { id: DAD, role: 'giver', active: true },
  { id: OLDER, role: 'taker', active: true },
  { id: YOUNGER, role: 'taker', active: true },
  { id: JAKUB, role: 'admin', active: true },
]
const withMum: Person[] = [...family, { id: MUM, role: 'giver', active: true }]

const DEFAULTS: PeriodDefaults = {
  lengthDays: DEFAULT_LENGTH_DAYS,
  cutoff: DEFAULT_CUTOFF,
  levels: { lower: 50, upper: 100 },
}

/** A Prague wall time as an instant. */
const prague = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  fromPragueWallTime({ year, month, day, hour, minute })
const HOUR = 3_600_000
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms)
const hours = (from: Date, to: Date) => (to.getTime() - from.getTime()) / HOUR

function value<T>(result: Result<T, PeriodError>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error}`)
  return result.value
}
function error<T>(result: Result<T, PeriodError>): PeriodError {
  if (result.ok) throw new Error('expected an error')
  return result.error
}

// Sun 2026-11-15 18:00 → Sun 2026-11-22 18:00, no DST.
const WEEK: PeriodSpan = {
  startsAt: prague(2026, 11, 15, 18),
  cutoffAt: prague(2026, 11, 22, 18),
  levels: DEFAULTS.levels,
}

describe('default cutoff (spec §5.8)', () => {
  it('defaults are 7 days, Sunday 18:00 Prague', () => {
    expect(DEFAULT_LENGTH_DAYS).toBe(7)
    expect(DEFAULT_CUTOFF).toEqual({ weekday: 0, hour: 18, minute: 0 })
  })

  it('a period from Sunday 18:00 ends the next Sunday 18:00', () => {
    expect(defaultCutoff(WEEK.startsAt, DEFAULTS)).toEqual(WEEK.cutoffAt)
  })

  it('a period that starts on a Wednesday ends on the Sunday nearest a week later', () => {
    const wed = prague(2026, 11, 18, 18)
    expect(defaultCutoff(wed, DEFAULTS)).toEqual(prague(2026, 11, 22, 18))
    const fri = prague(2026, 11, 20, 18)
    expect(defaultCutoff(fri, DEFAULTS)).toEqual(prague(2026, 11, 29, 18))
  })

  it('a period that starts on a Saturday does not end the next day', () => {
    const sat = prague(2026, 11, 28, 12)
    expect(defaultCutoff(sat, DEFAULTS)).toEqual(prague(2026, 12, 6, 18))
  })

  it('14-day length: two Sundays later', () => {
    const two = { ...DEFAULTS, lengthDays: 14 }
    expect(defaultCutoff(WEEK.startsAt, two)).toEqual(prague(2026, 11, 29, 18))
    // From a Wednesday: the Sunday nearest two weeks later.
    expect(defaultCutoff(prague(2026, 11, 18, 18), two)).toEqual(prague(2026, 11, 29, 18))
  })

  it('a length below a week still ends at the next default cutoff', () => {
    const short = { ...DEFAULTS, lengthDays: 3 }
    expect(defaultCutoff(WEEK.startsAt, short)).toEqual(WEEK.cutoffAt)
  })

  it('a cutoff never equals the start', () => {
    for (const lengthDays of [1, 3, 7, 8, 13, 14, 30]) {
      const cutoff = defaultCutoff(WEEK.startsAt, { ...DEFAULTS, lengthDays })
      expect(cutoff.getTime()).toBeGreaterThan(WEEK.startsAt.getTime())
      // Within half a week of the length (or the next Sunday for short lengths).
      expect(hours(WEEK.startsAt, cutoff)).toBeLessThanOrEqual(Math.max(lengthDays + 3.5, 7) * 24)
    }
  })

  it('autumn DST: Sun 18 Oct → Sun 25 Oct 18:00 is 169 hours', () => {
    const start = prague(2026, 10, 18, 18)
    const cutoff = defaultCutoff(start, DEFAULTS)
    expect(toPragueWallTime(cutoff)).toMatchObject({ month: 10, day: 25, hour: 18, minute: 0 })
    expect(hours(start, cutoff)).toBe(169)
  })

  it('spring DST: Sun 22 Mar → Sun 29 Mar 18:00 is 167 hours', () => {
    const start = prague(2026, 3, 22, 18)
    const cutoff = defaultCutoff(start, DEFAULTS)
    expect(toPragueWallTime(cutoff)).toMatchObject({ month: 3, day: 29, hour: 18, minute: 0 })
    expect(hours(start, cutoff)).toBe(167)
  })

  it('validates defaults', () => {
    expect(isValidDefaults(DEFAULTS)).toBe(true)
    expect(isValidDefaults({ ...DEFAULTS, lengthDays: 0 })).toBe(false)
    expect(isValidDefaults({ ...DEFAULTS, lengthDays: 2.5 })).toBe(false)
    expect(isValidDefaults({ ...DEFAULTS, cutoff: { weekday: 0, hour: 24, minute: 0 } })).toBe(
      false,
    )
    expect(isValidDefaults({ ...DEFAULTS, cutoff: { weekday: 0, hour: 18, minute: 60 } })).toBe(
      false,
    )
    expect(isValidDefaults({ ...DEFAULTS, levels: { lower: 100, upper: 50 } })).toBe(false)
  })
})

describe('chain of periods (spec §5.8)', () => {
  it('the first period starts now and ends at the next default cutoff', () => {
    const now = prague(2026, 11, 17, 19, 36)
    expect(firstPeriod(now, DEFAULTS)).toEqual({
      startsAt: now,
      cutoffAt: prague(2026, 11, 22, 18),
      levels: DEFAULTS.levels,
    })
  })

  it('the next period starts exactly at the cutoff, with the defaults', () => {
    expect(nextPeriod(WEEK, DEFAULTS, null)).toEqual({
      startsAt: WEEK.cutoffAt,
      cutoffAt: prague(2026, 11, 29, 18),
      levels: DEFAULTS.levels,
    })
  })

  it('new defaults apply to the next period, not the running one', () => {
    const newDefaults = { ...DEFAULTS, levels: { lower: 60, upper: 120 } }
    const next = nextPeriod(WEEK, newDefaults, null)
    expect(next.levels).toEqual({ lower: 60, upper: 120 })
    expect(WEEK.levels).toEqual({ lower: 50, upper: 100 })
  })

  it('an agreed change for exactly the next period wins over the defaults', () => {
    const settings = { cutoffAt: prague(2026, 11, 28, 12), levels: { lower: 40, upper: 80 } }
    const agreed = agreedProposal(WEEK.cutoffAt, settings)
    expect(nextPeriod(WEEK, DEFAULTS, agreed)).toEqual({ startsAt: WEEK.cutoffAt, ...settings })
  })

  it('a proposal that is not agreed, or is for another start, is ignored', () => {
    const settings = { cutoffAt: prague(2026, 11, 28, 12), levels: { lower: 40, upper: 80 } }
    const pending = { ...agreedProposal(WEEK.cutoffAt, settings), status: 'pending' as const }
    const elsewhere = agreedProposal(prague(2026, 11, 29, 18), settings)
    expect(nextPeriod(WEEK, DEFAULTS, pending).levels).toEqual(DEFAULTS.levels)
    expect(nextPeriod(WEEK, DEFAULTS, elsewhere).levels).toEqual(DEFAULTS.levels)
  })

  it('after a one-off Saturday cutoff, the chain returns to Sunday 18:00', () => {
    const settings = { cutoffAt: prague(2026, 11, 28, 12), levels: DEFAULTS.levels }
    const short = nextPeriod(WEEK, DEFAULTS, agreedProposal(WEEK.cutoffAt, settings))
    expect(nextPeriod(short, DEFAULTS, null).cutoffAt).toEqual(prague(2026, 12, 6, 18))
  })

  it('nothing starts before the cutoff', () => {
    expect(periodsToStart(WEEK, plus(WEEK.cutoffAt, -1), DEFAULTS, null)).toEqual([])
  })

  it('[call] the next period starts at the cutoff even without a settlement', () => {
    const started = periodsToStart(WEEK, WEEK.cutoffAt, DEFAULTS, null)
    expect(started).toEqual([nextPeriod(WEEK, DEFAULTS, null)])
  })

  it('catches up over several missed cutoffs; an agreed change applies only to the first', () => {
    const settings = { cutoffAt: prague(2026, 11, 28, 12), levels: { lower: 40, upper: 80 } }
    const now = prague(2026, 12, 8, 9)
    const started = periodsToStart(WEEK, now, DEFAULTS, agreedProposal(WEEK.cutoffAt, settings))
    expect(started.map((p) => [p.startsAt, p.cutoffAt, p.levels])).toEqual([
      [prague(2026, 11, 22, 18), prague(2026, 11, 28, 12), { lower: 40, upper: 80 }],
      [prague(2026, 11, 28, 12), prague(2026, 12, 6, 18), DEFAULTS.levels],
      [prague(2026, 12, 6, 18), prague(2026, 12, 13, 18), DEFAULTS.levels],
    ])
  })

  it('a period has started from its first instant; settlement is allowed from the cutoff on', () => {
    expect(hasStarted(WEEK, plus(WEEK.startsAt, -1))).toBe(false)
    expect(hasStarted(WEEK, WEEK.startsAt)).toBe(true)
    expect(canSettle(WEEK, plus(WEEK.cutoffAt, -1))).toBe(false)
    expect(canSettle(WEEK, WEEK.cutoffAt)).toBe(true)
    expect(canSettle(WEEK, plus(WEEK.cutoffAt, 3 * 24 * HOUR))).toBe(true)
  })
})

describe('attribution by completedAt (spec §5.5, §5.8)', () => {
  const NEXT = nextPeriod(WEEK, DEFAULTS, null)
  const periods = [WEEK, NEXT]

  it('a completion belongs to the period its completedAt falls in', () => {
    expect(periodAt(periods, prague(2026, 11, 20, 10))).toBe(WEEK)
    expect(periodAt(periods, prague(2026, 11, 25, 10))).toBe(NEXT)
  })

  it('one millisecond before the cutoff → this period; exactly at the cutoff → the next', () => {
    expect(periodAt(periods, plus(WEEK.cutoffAt, -1))).toBe(WEEK)
    expect(periodAt(periods, WEEK.cutoffAt)).toBe(NEXT)
  })

  it('the first instant of a period belongs to it', () => {
    expect(periodAt(periods, WEEK.startsAt)).toBe(WEEK)
  })

  it('done before the cutoff, approved after it: still counts for the old period', () => {
    const completedAt = prague(2026, 11, 22, 17, 59)
    // Approval at Monday is irrelevant: only completedAt is looked at.
    expect(periodAt(periods, completedAt)).toBe(WEEK)
  })

  it('outside every period → undefined', () => {
    expect(periodAt(periods, plus(WEEK.startsAt, -1))).toBeUndefined()
    expect(periodAt(periods, NEXT.cutoffAt)).toBeUndefined()
  })

  it('across autumn DST: 18:00 on the cutoff Sunday is the boundary in winter time', () => {
    const start = prague(2026, 10, 18, 18)
    const week = {
      startsAt: start,
      cutoffAt: defaultCutoff(start, DEFAULTS),
      levels: DEFAULTS.levels,
    }
    const next = nextPeriod(week, DEFAULTS, null)
    expect(periodAt([week, next], prague(2026, 10, 25, 17, 59))).toBe(week)
    expect(periodAt([week, next], prague(2026, 10, 25, 18, 0))).toBe(next)
    // The repeated hour 02:00–02:59 that night is inside the old period.
    expect(periodAt([week, next], new Date('2026-10-25T00:30:00.000Z'))).toBe(week)
    expect(periodAt([week, next], new Date('2026-10-25T01:30:00.000Z'))).toBe(week)
  })
})

function agreedProposal(
  periodStartsAt: Date,
  settings: PeriodSettingsProposal['settings'],
): PeriodSettingsProposal {
  return {
    periodStartsAt,
    settings,
    proposedBy: DAD,
    approvedBy: [DAD, OLDER, YOUNGER],
    status: 'agreed',
    closedBy: null,
  }
}

describe('period agreement (spec §3)', () => {
  it('needs every active taker and one giver', () => {
    expect(isPeriodAgreed([DAD, OLDER, YOUNGER], family)).toBe(true)
    expect(isPeriodAgreed([DAD, OLDER], family)).toBe(false)
    expect(isPeriodAgreed([OLDER, YOUNGER], family)).toBe(false)
  })

  it('the admin never counts', () => {
    expect(isPeriodAgreed([JAKUB, OLDER, YOUNGER], family)).toBe(false)
  })

  it('with Mum, one giver is still enough', () => {
    expect(isPeriodAgreed([MUM, OLDER, YOUNGER], withMum)).toBe(true)
  })
})

describe('per-period proposals (spec §5.8)', () => {
  const NEXT_START = WEEK.cutoffAt
  const NOW = prague(2026, 11, 22, 19) // the meeting, after WEEK's cutoff
  const FOLLOWING_START = prague(2026, 11, 29, 18)
  const settings = { cutoffAt: prague(2026, 12, 5, 12), levels: { lower: 40, upper: 80 } }

  const propose = (by = DAD, startsAt = FOLLOWING_START, existing: PeriodSettingsProposal[] = []) =>
    proposePeriodSettings(family, by, startsAt, settings, existing, NOW)

  it('a giver proposes at the meeting; proposing counts as approving', () => {
    expect(value(propose())).toEqual({
      periodStartsAt: FOLLOWING_START,
      settings,
      proposedBy: DAD,
      approvedBy: [DAD],
      status: 'pending',
      closedBy: null,
    })
  })

  it('[call] a taker may propose too', () => {
    expect(value(propose(OLDER)).approvedBy).toEqual([OLDER])
  })

  it('the admin is not a party and cannot propose', () => {
    expect(error(propose(JAKUB))).toBe('not_a_party')
  })

  it('refused for a period that has already started (locked)', () => {
    expect(error(propose(DAD, NEXT_START))).toBe('already_started')
    expect(
      error(proposePeriodSettings(family, DAD, FOLLOWING_START, settings, [], FOLLOWING_START)),
    ).toBe('already_started')
  })

  it('refuses a cutoff at or before the start, or bad levels', () => {
    const at = { ...settings, cutoffAt: FOLLOWING_START }
    expect(error(proposePeriodSettings(family, DAD, FOLLOWING_START, at, [], NOW))).toBe(
      'invalid_settings',
    )
    const bad = { ...settings, levels: { lower: 0, upper: 80 } }
    expect(error(proposePeriodSettings(family, DAD, FOLLOWING_START, bad, [], NOW))).toBe(
      'invalid_settings',
    )
  })

  it('[call] one pending proposal per period', () => {
    const first = value(propose())
    expect(error(propose(OLDER, FOLLOWING_START, [first]))).toBe('proposal_pending')
    const rejected = value(rejectPeriodProposal(first, family, YOUNGER))
    expect(propose(OLDER, FOLLOWING_START, [rejected]).ok).toBe(true)
  })

  it('agreed once both takers approve', () => {
    const p = value(propose())
    const one = value(approvePeriodSettings(p, family, OLDER, NOW))
    expect(one.status).toBe('pending')
    const both = value(approvePeriodSettings(one, family, YOUNGER, NOW))
    expect(both.status).toBe('agreed')
    expect(both.approvedBy).toEqual([DAD, OLDER, YOUNGER])
  })

  it('a taker-made proposal needs the other taker and a giver', () => {
    const p = value(propose(OLDER))
    const takers = value(approvePeriodSettings(p, family, YOUNGER, NOW))
    expect(takers.status).toBe('pending')
    expect(value(approvePeriodSettings(takers, family, DAD, NOW)).status).toBe('agreed')
  })

  it('the admin cannot approve; nobody approves twice', () => {
    const p = value(propose())
    expect(error(approvePeriodSettings(p, family, JAKUB, NOW))).toBe('not_a_party')
    expect(error(approvePeriodSettings(p, family, DAD, NOW))).toBe('already_approved')
  })

  it('approvals after the period started are refused, and the proposal lapses', () => {
    const p = value(approvePeriodSettings(value(propose()), family, OLDER, NOW))
    expect(error(approvePeriodSettings(p, family, YOUNGER, FOLLOWING_START))).toBe(
      'already_started',
    )
    expect(lapsePeriodSettings(p, plus(FOLLOWING_START, -1)).status).toBe('pending')
    expect(lapsePeriodSettings(p, FOLLOWING_START).status).toBe('lapsed')
  })

  it('an agreed proposal does not lapse', () => {
    const agreed = agreedProposal(FOLLOWING_START, settings)
    expect(lapsePeriodSettings(agreed, FOLLOWING_START)).toBe(agreed)
  })

  it('[call] any party rejects and it closes', () => {
    const p = value(propose())
    const rejected = value(rejectPeriodProposal(p, family, YOUNGER))
    expect(rejected).toMatchObject({ status: 'rejected', closedBy: YOUNGER })
    expect(error(approvePeriodSettings(rejected, family, OLDER, NOW))).toBe('not_pending')
    expect(error(rejectPeriodProposal(p, family, JAKUB))).toBe('not_a_party')
  })

  it('only the proposer withdraws', () => {
    const p = value(propose())
    expect(error(withdrawPeriodProposal(p, OLDER))).toBe('not_proposer')
    expect(value(withdrawPeriodProposal(p, DAD))).toMatchObject({
      status: 'withdrawn',
      closedBy: DAD,
    })
  })

  it('becomes agreed when the people list changes (approvals checked live)', () => {
    const p = value(approvePeriodSettings(value(propose()), family, OLDER, NOW))
    // YOUNGER no longer a taker (e.g. role changed): every remaining taker approved.
    const changed = family.map((x) => (x.id === YOUNGER ? { ...x, role: 'giver' as const } : x))
    expect(resolvePeriodProposal(p, family).status).toBe('pending')
    expect(resolvePeriodProposal(p, changed).status).toBe('agreed')
  })
})

describe('default settings (spec §5.8)', () => {
  const newDefaults: PeriodDefaults = { ...DEFAULTS, levels: { lower: 60, upper: 120 } }

  it('the admin changes them directly', () => {
    expect(value(setDefaults(family, JAKUB, newDefaults))).toEqual(newDefaults)
    expect(error(setDefaults(family, DAD, newDefaults))).toBe('not_admin')
    expect(error(setDefaults(family, JAKUB, { ...DEFAULTS, lengthDays: 0 }))).toBe(
      'invalid_settings',
    )
  })

  it('a giver proposes; it needs period agreement', () => {
    const p = value(proposeDefaults(family, DAD, newDefaults, []))
    expect(p).toMatchObject({ status: 'pending', approvedBy: [DAD], settings: newDefaults })
    const one = value(approveDefaults(p, family, OLDER))
    expect(one.status).toBe('pending')
    expect(value(approveDefaults(one, family, YOUNGER)).status).toBe('agreed')
  })

  it('takers and the admin cannot propose defaults', () => {
    expect(error(proposeDefaults(family, OLDER, newDefaults, []))).toBe('not_a_giver')
    expect(error(proposeDefaults(family, JAKUB, newDefaults, []))).toBe('not_a_giver')
  })

  it('[call] one pending default proposal at a time', () => {
    const p = value(proposeDefaults(family, DAD, newDefaults, []))
    expect(error(proposeDefaults(withMum, MUM, newDefaults, [p]))).toBe('proposal_pending')
    const withdrawn = value(withdrawPeriodProposal(p, DAD))
    expect(proposeDefaults(withMum, MUM, newDefaults, [withdrawn]).ok).toBe(true)
  })

  it('[call] an unagreed default proposal never lapses: approvals keep working later', () => {
    const p: DefaultsProposal = value(proposeDefaults(family, DAD, newDefaults, []))
    // Several periods later, the takers still can agree.
    const one = value(approveDefaults(p, family, OLDER))
    expect(value(approveDefaults(one, family, YOUNGER)).status).toBe('agreed')
  })

  it('invalid defaults are refused', () => {
    expect(error(proposeDefaults(family, DAD, { ...DEFAULTS, lengthDays: -7 }, []))).toBe(
      'invalid_settings',
    )
  })
})
