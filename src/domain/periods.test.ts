import { describe, expect, it } from 'vitest'
import { fromPragueWallTime, toPragueWallTime } from './dates'
import type { Person } from './parties'
import type {
  DefaultsProposal,
  PeriodDefaults,
  Period,
  PeriodError,
  PeriodSettingsProposal,
} from './periods'
import {
  DEFAULT_CUTOFF,
  DEFAULT_LENGTH_DAYS,
  DEFAULT_PERIOD_DEFAULTS,
  endPeriodEarly,
  isRunning,
  periodEnd,
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

// The chain algorithm is tested with a Sunday 18:00 cutoff (any weekday and time works the
// same). The real defaults (Sunday 23:59) have their own tests below.
const DEFAULTS: PeriodDefaults = {
  lengthDays: DEFAULT_LENGTH_DAYS,
  cutoff: { weekday: 0, hour: 18, minute: 0 },
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
const WEEK: Period = {
  id: 1,
  startsAt: prague(2026, 11, 15, 18),
  cutoffAt: prague(2026, 11, 22, 18),
  levels: DEFAULTS.levels,
}

describe('default cutoff (spec §5.8)', () => {
  it('defaults: 7 days, Sunday 23:59 Prague, levels 50/100 (Jakub 2026-11-21)', () => {
    expect(DEFAULT_LENGTH_DAYS).toBe(7)
    expect(DEFAULT_CUTOFF).toEqual({ weekday: 0, hour: 23, minute: 59 })
    expect(DEFAULT_PERIOD_DEFAULTS).toEqual({
      lengthDays: 7,
      cutoff: { weekday: 0, hour: 23, minute: 59 },
      levels: { lower: 50, upper: 100 },
    })
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

  it('[call] a tie goes to the later Sunday', () => {
    // Thu 06:00 + 7 days is 3.5 days from both Sundays.
    expect(defaultCutoff(prague(2026, 11, 19, 6), DEFAULTS)).toEqual(prague(2026, 11, 29, 18))
  })

  it('a cutoff is after the start and within half a week of the length', () => {
    for (const lengthDays of [7, 14, 21, 28]) {
      for (const start of [WEEK.startsAt, prague(2026, 11, 18, 9), prague(2026, 11, 21, 23)]) {
        const cutoff = defaultCutoff(start, { ...DEFAULTS, lengthDays })
        expect(cutoff.getTime()).toBeGreaterThan(start.getTime())
        expect(Math.abs(hours(start, cutoff) - lengthDays * 24)).toBeLessThanOrEqual(3.5 * 24)
      }
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
    expect(isValidDefaults({ ...DEFAULTS, lengthDays: 14 })).toBe(true)
    expect(isValidDefaults({ ...DEFAULTS, lengthDays: 0 })).toBe(false)
    // [call] whole weeks only: the cutoff is a weekday.
    expect(isValidDefaults({ ...DEFAULTS, lengthDays: 3 })).toBe(false)
    expect(isValidDefaults({ ...DEFAULTS, lengthDays: 10 })).toBe(false)
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
    const agreed = agreedProposal(WEEK.id, settings)
    expect(nextPeriod(WEEK, DEFAULTS, agreed)).toEqual({ startsAt: WEEK.cutoffAt, ...settings })
  })

  it('a proposal that is not agreed, or is for the period after another one, is ignored', () => {
    const settings = { cutoffAt: prague(2026, 11, 28, 12), levels: { lower: 40, upper: 80 } }
    const pending = { ...agreedProposal(WEEK.id, settings), status: 'pending' as const }
    const elsewhere = agreedProposal(2, settings)
    expect(nextPeriod(WEEK, DEFAULTS, pending).levels).toEqual(DEFAULTS.levels)
    expect(nextPeriod(WEEK, DEFAULTS, elsewhere).levels).toEqual(DEFAULTS.levels)
  })

  it('after a one-off Saturday cutoff, the chain returns to Sunday 18:00', () => {
    const settings = { cutoffAt: prague(2026, 11, 28, 12), levels: DEFAULTS.levels }
    const short = nextPeriod(WEEK, DEFAULTS, agreedProposal(WEEK.id, settings))
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
    const started = periodsToStart(WEEK, now, DEFAULTS, agreedProposal(WEEK.id, settings))
    expect(started.map((p) => [p.startsAt, p.cutoffAt, p.levels])).toEqual([
      [prague(2026, 11, 22, 18), prague(2026, 11, 28, 12), { lower: 40, upper: 80 }],
      [prague(2026, 11, 28, 12), prague(2026, 12, 6, 18), DEFAULTS.levels],
      [prague(2026, 12, 6, 18), prague(2026, 12, 13, 18), DEFAULTS.levels],
    ])
  })

  it('a period has started from its first instant', () => {
    expect(hasStarted(WEEK, plus(WEEK.startsAt, -1))).toBe(false)
    expect(hasStarted(WEEK, WEEK.startsAt)).toBe(true)
  })

  it('settlement is allowed from the start, before and after the cutoff; not once ended early', () => {
    // Spec §5.8 (Jakub 2026-11-21): settling the running period ends it; a period that ended at
    // its cutoff can be settled any time after.
    expect(canSettle(WEEK, plus(WEEK.startsAt, -1))).toBe(false)
    // The first instant: endPeriodEarly refuses it too (a period must have length).
    expect(canSettle(WEEK, WEEK.startsAt)).toBe(false)
    expect(canSettle(WEEK, plus(WEEK.startsAt, 1))).toBe(true)
    expect(canSettle(WEEK, plus(WEEK.cutoffAt, -1))).toBe(true)
    expect(canSettle(WEEK, plus(WEEK.cutoffAt, 3 * 24 * HOUR))).toBe(true)
    const ended = { ...WEEK, endedAt: prague(2026, 11, 22, 17) }
    expect(canSettle(ended, prague(2026, 11, 22, 17, 30))).toBe(false)
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

describe('attribution across spring DST', () => {
  it('18:00 on the cutoff Sunday is the boundary in summer time', () => {
    const start = prague(2026, 3, 22, 18)
    const week = {
      startsAt: start,
      cutoffAt: defaultCutoff(start, DEFAULTS),
      levels: DEFAULTS.levels,
    }
    const next = nextPeriod(week, DEFAULTS, null)
    expect(periodAt([week, next], prague(2026, 3, 29, 17, 59))).toBe(week)
    expect(periodAt([week, next], prague(2026, 3, 29, 18, 0))).toBe(next)
    // 03:30 CEST right after the skipped hour is still the old period.
    expect(periodAt([week, next], new Date('2026-03-29T01:30:00.000Z'))).toBe(week)
  })
})

function agreedProposal(
  afterPeriodId: number,
  settings: PeriodSettingsProposal['settings'],
): PeriodSettingsProposal {
  return {
    afterPeriodId,
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

  // The running period at the meeting: WEEK has ended, its successor runs until FOLLOWING_START.
  const CURRENT: Period = {
    id: 2,
    startsAt: NEXT_START,
    cutoffAt: FOLLOWING_START,
    levels: DEFAULTS.levels,
  }
  const propose = (by = DAD, existing: PeriodSettingsProposal[] = []) =>
    proposePeriodSettings(family, by, CURRENT, settings, existing, NOW)

  it('a giver proposes at the meeting; proposing counts as approving', () => {
    expect(value(propose())).toEqual({
      afterPeriodId: CURRENT.id,
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

  it('targets the period after the running one', () => {
    expect(value(propose()).afterPeriodId).toBe(CURRENT.id)
  })

  it('refused for a period that has already started (locked)', () => {
    // WEEK passed as "current" at the meeting: its successor already started at 18:00.
    expect(error(proposePeriodSettings(family, DAD, WEEK, settings, [], NOW))).toBe(
      'already_started',
    )
    expect(error(proposePeriodSettings(family, DAD, CURRENT, settings, [], FOLLOWING_START))).toBe(
      'already_started',
    )
  })

  it('refuses a cutoff at or before the start, or bad levels', () => {
    const at = { ...settings, cutoffAt: FOLLOWING_START }
    expect(error(proposePeriodSettings(family, DAD, CURRENT, at, [], NOW))).toBe('invalid_settings')
    const bad = { ...settings, levels: { lower: 0, upper: 80 } }
    expect(error(proposePeriodSettings(family, DAD, CURRENT, bad, [], NOW))).toBe(
      'invalid_settings',
    )
  })

  it('[call] one pending proposal per period', () => {
    const first = value(propose())
    expect(error(propose(OLDER, [first]))).toBe('proposal_pending')
    const rejected = value(rejectPeriodProposal(first, family, YOUNGER))
    expect(propose(OLDER, [rejected]).ok).toBe(true)
  })

  it('[call] once one is agreed for that period, no new proposal', () => {
    const agreed = agreedProposal(CURRENT.id, settings)
    expect(error(propose(OLDER, [agreed]))).toBe('already_agreed')
  })

  it('agreed once both takers approve', () => {
    const p = value(propose())
    const one = value(approvePeriodSettings(p, family, OLDER, CURRENT, NOW))
    expect(one.status).toBe('pending')
    const both = value(approvePeriodSettings(one, family, YOUNGER, CURRENT, NOW))
    expect(both.status).toBe('agreed')
    expect(both.approvedBy).toEqual([DAD, OLDER, YOUNGER])
  })

  it('a taker-made proposal needs the other taker and a giver', () => {
    const p = value(propose(OLDER))
    const takers = value(approvePeriodSettings(p, family, YOUNGER, CURRENT, NOW))
    expect(takers.status).toBe('pending')
    expect(value(approvePeriodSettings(takers, family, DAD, CURRENT, NOW)).status).toBe('agreed')
  })

  it('the admin cannot approve; nobody approves twice', () => {
    const p = value(propose())
    expect(error(approvePeriodSettings(p, family, JAKUB, CURRENT, NOW))).toBe('not_a_party')
    expect(error(approvePeriodSettings(p, family, DAD, CURRENT, NOW))).toBe('already_approved')
  })

  it('approvals after the period started are refused, and the proposal lapses', () => {
    const p = value(approvePeriodSettings(value(propose()), family, OLDER, CURRENT, NOW))
    expect(error(approvePeriodSettings(p, family, YOUNGER, CURRENT, FOLLOWING_START))).toBe(
      'already_started',
    )
    expect(lapsePeriodSettings(p, CURRENT, plus(FOLLOWING_START, -1)).status).toBe('pending')
    expect(lapsePeriodSettings(p, CURRENT, FOLLOWING_START).status).toBe('lapsed')
  })

  it('a closed proposal stays not_pending after its period started', () => {
    const rejected = value(rejectPeriodProposal(value(propose()), family, YOUNGER))
    expect(error(approvePeriodSettings(rejected, family, OLDER, CURRENT, FOLLOWING_START))).toBe(
      'not_pending',
    )
  })

  it('an agreed proposal does not lapse', () => {
    const agreed = agreedProposal(CURRENT.id, settings)
    expect(lapsePeriodSettings(agreed, CURRENT, FOLLOWING_START)).toBe(agreed)
  })

  it('[call] any party rejects and it closes', () => {
    const p = value(propose())
    const rejected = value(rejectPeriodProposal(p, family, YOUNGER))
    expect(rejected).toMatchObject({ status: 'rejected', closedBy: YOUNGER })
    expect(error(approvePeriodSettings(rejected, family, OLDER, CURRENT, NOW))).toBe('not_pending')
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
    const p = value(approvePeriodSettings(value(propose()), family, OLDER, CURRENT, NOW))
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

describe('Sunday 23:59 defaults (Jakub 2026-11-21, spec §5.8)', () => {
  const D = DEFAULT_PERIOD_DEFAULTS
  // Sun 22 Nov 23:59 → Sun 29 Nov 23:59.
  const RUNNING: Period = {
    id: 7,
    startsAt: prague(2026, 11, 22, 23, 59),
    cutoffAt: prague(2026, 11, 29, 23, 59),
    levels: D.levels,
  }

  it('a period from Sunday 23:59 ends the next Sunday 23:59', () => {
    expect(defaultCutoff(RUNNING.startsAt, D)).toEqual(RUNNING.cutoffAt)
  })

  it('a first period from Sat 21 Nov 20:00 or Mon 23 Nov 09:00 ends Sun 29 Nov 23:59', () => {
    expect(firstPeriod(prague(2026, 11, 21, 20), D).cutoffAt).toEqual(RUNNING.cutoffAt)
    expect(firstPeriod(prague(2026, 11, 23, 9), D).cutoffAt).toEqual(RUNNING.cutoffAt)
  })

  it('autumn DST: Sun 18 Oct 23:59 → Sun 25 Oct 23:59 is 169 hours', () => {
    const start = prague(2026, 10, 18, 23, 59)
    const cutoff = defaultCutoff(start, D)
    expect(toPragueWallTime(cutoff)).toMatchObject({ month: 10, day: 25, hour: 23, minute: 59 })
    expect(hours(start, cutoff)).toBe(169)
  })

  it('spring DST: Sun 22 Mar 23:59 → Sun 29 Mar 23:59 is 167 hours', () => {
    const start = prague(2026, 3, 22, 23, 59)
    const cutoff = defaultCutoff(start, D)
    expect(toPragueWallTime(cutoff)).toMatchObject({ month: 3, day: 29, hour: 23, minute: 59 })
    expect(hours(start, cutoff)).toBe(167)
  })

  describe('settling ends the period', () => {
    it('on Sunday 20:00: the next period runs to the next Sunday 23:59', () => {
      const at = prague(2026, 11, 29, 20)
      const { ended, next } = value(endPeriodEarly(RUNNING, at, D, null))
      expect(ended).toEqual({ ...RUNNING, endedAt: at })
      expect(next).toEqual({
        startsAt: at,
        cutoffAt: prague(2026, 12, 6, 23, 59),
        levels: D.levels,
      })
    })

    it('at Sunday 23:58: still the next Sunday 23:59, not the same night', () => {
      const at = prague(2026, 11, 29, 23, 58)
      expect(value(endPeriodEarly(RUNNING, at, D, null)).next.cutoffAt).toEqual(
        prague(2026, 12, 6, 23, 59),
      )
    })

    it('on Saturday 20:00: the Sunday 23:59 eight days later', () => {
      const at = prague(2026, 11, 28, 20)
      expect(value(endPeriodEarly(RUNNING, at, D, null)).next.cutoffAt).toEqual(
        prague(2026, 12, 6, 23, 59),
      )
    })

    it('refused at or after the cutoff, at or before the start, and once ended', () => {
      expect(error(endPeriodEarly(RUNNING, RUNNING.cutoffAt, D, null))).toBe('not_running')
      expect(error(endPeriodEarly(RUNNING, plus(RUNNING.cutoffAt, 1), D, null))).toBe('not_running')
      expect(error(endPeriodEarly(RUNNING, RUNNING.startsAt, D, null))).toBe('not_running')
      expect(error(endPeriodEarly(RUNNING, plus(RUNNING.startsAt, -1), D, null))).toBe(
        'not_running',
      )
      expect(endPeriodEarly(RUNNING, plus(RUNNING.startsAt, 1), D, null).ok).toBe(true)
      expect(endPeriodEarly(RUNNING, plus(RUNNING.cutoffAt, -1), D, null).ok).toBe(true)
      const ended = { ...RUNNING, endedAt: prague(2026, 11, 29, 20) }
      expect(error(endPeriodEarly(ended, prague(2026, 11, 29, 21), D, null))).toBe('not_running')
    })

    it('an agreed change for the period after RUNNING applies after an early end', () => {
      const settings = { cutoffAt: prague(2026, 12, 5, 23, 59), levels: { lower: 40, upper: 90 } }
      const at = prague(2026, 11, 29, 20)
      expect(value(endPeriodEarly(RUNNING, at, D, agreedProposal(7, settings))).next).toEqual({
        startsAt: at,
        ...settings,
      })
      expect(
        value(endPeriodEarly(RUNNING, at, D, agreedProposal(6, settings))).next.levels,
      ).toEqual(D.levels)
    })

    it('a pending proposal can not be made or approved, and lapses, once its period ended early', () => {
      const at = prague(2026, 11, 29, 20)
      const settings = { cutoffAt: prague(2026, 12, 5, 23, 59), levels: { lower: 40, upper: 90 } }
      const p = value(proposePeriodSettings(family, DAD, RUNNING, settings, [], plus(at, -HOUR)))
      const { ended, next } = value(endPeriodEarly(RUNNING, at, D, null))
      const endedP: Period = { ...ended, id: RUNNING.id }
      const nextP: Period = { ...next, id: 8 }
      expect(error(approvePeriodSettings(p, family, OLDER, endedP, plus(at, 1)))).toBe(
        'already_started',
      )
      expect(error(approvePeriodSettings(p, family, OLDER, nextP, plus(at, 1)))).toBe(
        'already_started',
      )
      expect(lapsePeriodSettings(p, RUNNING, plus(at, -1)).status).toBe('pending')
      expect(lapsePeriodSettings(p, endedP, at).status).toBe('lapsed')
      expect(error(proposePeriodSettings(family, DAD, endedP, settings, [], plus(at, 1)))).toBe(
        'already_started',
      )
    })

    it('attribution: the early end instant belongs to the next period', () => {
      const at = prague(2026, 11, 29, 20)
      const { ended, next } = value(endPeriodEarly(RUNNING, at, D, null))
      expect(periodEnd(ended)).toEqual(at)
      expect(periodAt([ended, next], plus(at, -1))).toBe(ended)
      expect(periodAt([ended, next], at)).toBe(next)
      expect(isRunning(ended, at)).toBe(false)
      expect(isRunning(next, at)).toBe(true)
      expect(isRunning(next, plus(at, -1))).toBe(false)
      expect(isRunning(ended, ended.startsAt)).toBe(true)
    })

    it('the chain continues from the early end', () => {
      const at = prague(2026, 11, 29, 20)
      const { ended } = value(endPeriodEarly(RUNNING, at, D, null))
      expect(periodsToStart(ended, plus(at, -1), D, null)).toEqual([])
      expect(periodsToStart(ended, at, D, null)).toEqual([
        { startsAt: at, cutoffAt: prague(2026, 12, 6, 23, 59), levels: D.levels },
      ])
    })
  })
})
