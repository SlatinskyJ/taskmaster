import { describe, expect, it } from 'vitest'
import { fromPragueWallTime } from '~/domain/dates'
import { LEVEL_MAX } from '~/lib/periodLimits'
import type { ProposalView, ProposalsView } from '~/server/periods/functions'
import { setLower, setUpper } from '../admin/defaultWeekForm'
import {
  agreementRows,
  initialNextWeek,
  lengthInDays,
  myActions,
  nextWeekCutoff,
  stepDays,
  waitingProposals,
  withinCap,
} from './proposalView'
import type { NextWeekForm } from './proposalView'

const prague = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  fromPragueWallTime({ year, month, day, hour, minute })

const START = prague(2026, 11, 29, 23, 59)
const form = (lengthDays: number, hour = 23, minute = 59): NextWeekForm => ({
  lengthDays,
  hour,
  minute,
  levels: { lower: 50, upper: 100 },
})

// Ids: Táta 2 (giver), Starší 3, Mladší 4 (takers), Máma 5 (giver).
const TATA = 2
const STARSI = 3
const MLADSI = 4
const MAMA = 5
const parties: ProposalsView['parties'] = [
  { id: TATA, name: 'Táta', role: 'giver' },
  { id: STARSI, name: 'Starší', role: 'taker' },
  { id: MLADSI, name: 'Mladší', role: 'taker' },
]
const withMama = [...parties, { id: MAMA, name: 'Máma', role: 'giver' as const }]

const proposal = (over: Partial<ProposalView<unknown>> = {}): ProposalView<unknown> => ({
  id: 1,
  settings: null,
  proposedBy: STARSI,
  approvedBy: [STARSI],
  status: 'pending',
  waitingFor: [TATA, MLADSI],
  ...over,
})

describe('nextWeekCutoff', () => {
  it('counts whole days from next.startsAt, at the form time', () => {
    expect(nextWeekCutoff(START, form(7)).toISOString()).toBe('2026-12-06T22:59:00.000Z')
    expect(nextWeekCutoff(START, form(1))).toEqual(prague(2026, 11, 30, 23, 59))
    expect(nextWeekCutoff(START, form(7, 18, 0))).toEqual(prague(2026, 12, 6, 18, 0))
  })

  it('across the DST change ends on the same wall time', () => {
    expect(nextWeekCutoff(prague(2026, 3, 22, 23, 59), form(7))).toEqual(
      prague(2026, 3, 29, 23, 59),
    )
  })
})

describe('initialNextWeek', () => {
  it('takes the length, time and levels of the server span', () => {
    expect(
      initialNextWeek({
        startsAt: prague(2026, 12, 2, 23, 59),
        cutoffAt: prague(2026, 12, 6, 18, 30),
        levels: { lower: 60, upper: 120 },
      }),
    ).toEqual({ lengthDays: 4, hour: 18, minute: 30, levels: { lower: 60, upper: 120 } })
  })
})

describe('stepDays and withinCap', () => {
  it('steps by one day and stops at 1 and 364', () => {
    expect(stepDays(form(7), 1).lengthDays).toBe(8)
    expect(stepDays(form(7), -1).lengthDays).toBe(6)
    expect(stepDays(form(1), -1).lengthDays).toBe(1)
    expect(stepDays(form(364), 1).lengthDays).toBe(364)
  })

  it('364 days at the start time is within the cap; one minute later is not', () => {
    expect(withinCap(START, form(364))).toBe(true)
    expect(withinCap(START, form(364, 0, 0))).toBe(true)
    const noon = prague(2026, 11, 29, 12, 0)
    expect(withinCap(noon, form(364, 12, 0))).toBe(true)
    expect(withinCap(noon, form(364, 12, 1))).toBe(false)
  })
})

describe('lengthInDays', () => {
  it('counts Prague calendar days, 7 over the DST change', () => {
    expect(lengthInDays(prague(2026, 3, 22, 23, 59), prague(2026, 3, 29, 23, 59))).toBe(7)
    expect(lengthInDays(prague(2026, 12, 2, 23, 59), prague(2026, 12, 6, 23, 59))).toBe(4)
  })
})

describe('setLower / setUpper on a next-week form', () => {
  it('clamps to LEVEL_MAX and keeps upper at or above lower', () => {
    expect(setLower(form(7), LEVEL_MAX + 5).levels).toEqual({ lower: LEVEL_MAX, upper: LEVEL_MAX })
    expect(setUpper(form(7), 10).levels).toEqual({ lower: 50, upper: 50 })
    expect(setLower(form(7), 70)).toEqual({ ...form(7), levels: { lower: 70, upper: 100 } })
  })
})

describe('myActions', () => {
  it('the proposer may only withdraw a pending proposal', () => {
    expect(myActions(proposal(), STARSI)).toEqual({ approve: false, reject: false, withdraw: true })
  })
  it('someone waiting may approve or reject', () => {
    expect(myActions(proposal(), MLADSI)).toEqual({ approve: true, reject: true, withdraw: false })
  })
  it('someone who approved already may still reject', () => {
    const p = proposal({ approvedBy: [STARSI, MLADSI], waitingFor: [TATA] })
    expect(myActions(p, MLADSI)).toEqual({ approve: false, reject: true, withdraw: false })
  })
  it('a second giver after one giver approved may only reject', () => {
    const p = proposal({ approvedBy: [STARSI, TATA], waitingFor: [MLADSI] })
    expect(myActions(p, MAMA)).toEqual({ approve: false, reject: true, withdraw: false })
  })
  it('an agreed proposal offers nothing', () => {
    const p = proposal({ status: 'agreed', approvedBy: [STARSI, MLADSI, TATA], waitingFor: [] })
    expect(myActions(p, STARSI)).toEqual({ approve: false, reject: false, withdraw: false })
    expect(myActions(p, MLADSI)).toEqual({ approve: false, reject: false, withdraw: false })
  })
})

describe('agreementRows', () => {
  it('with two givers and Táta approved, Máma is not listed', () => {
    const p = proposal({ approvedBy: [STARSI, TATA], waitingFor: [MLADSI] })
    expect(agreementRows(p, withMama)).toEqual([
      { id: TATA, name: 'Táta', agreed: true },
      { id: STARSI, name: 'Starší', agreed: true },
      { id: MLADSI, name: 'Mladší', agreed: false },
    ])
  })
  it('with no giver approved, both givers wait', () => {
    const p = proposal({ waitingFor: [TATA, MLADSI, MAMA] })
    expect(agreementRows(p, withMama)).toEqual([
      { id: TATA, name: 'Táta', agreed: false },
      { id: STARSI, name: 'Starší', agreed: true },
      { id: MLADSI, name: 'Mladší', agreed: false },
      { id: MAMA, name: 'Máma', agreed: false },
    ])
  })
})

describe('waitingProposals', () => {
  const view = (period: ProposalView<unknown> | null, defaults: ProposalView<unknown> | null) =>
    ({ period, defaults }) as unknown as ProposalsView
  it('lists each kind only when I am in its waitingFor', () => {
    const p = proposal()
    const d = proposal({
      id: 2,
      proposedBy: TATA,
      approvedBy: [TATA],
      waitingFor: [STARSI, MLADSI],
    })
    expect(waitingProposals(view(p, d), MLADSI)).toEqual(['period', 'defaults'])
    expect(waitingProposals(view(p, d), STARSI)).toEqual(['defaults'])
    expect(waitingProposals(view(p, d), TATA)).toEqual(['period'])
    expect(waitingProposals(view(null, null), MLADSI)).toEqual([])
  })
})
