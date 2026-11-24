import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { featureFlags } from '~/server/db/schema'
import { family, must, T0, T1, T2 } from '~/server/tasks/testing'
import {
  acceptTemplateBidHandler,
  acceptTemplateOfferHandler,
  bidTemplateScoreHandler,
  counterTemplateScoreHandler,
  turnDownTemplateBidsHandler,
  withdrawTemplateBidHandler,
} from './functions'
import { parseApproval, parseNewTemplate, parseTemplateId, parseTemplateTurnDown } from './parse'
import { createTemplate } from './templates'
import { threadRows } from './testing'

const VALID = {
  title: 'Vynést koše',
  score: 4,
  approvalRequired: true,
  schedule: { days: [2], time: { hour: 18, minute: 30 } },
  deadline: { dayOffset: 1, due: { hour: 7, minute: 45 }, graceMinutes: 90 },
}

describe('parseNewTemplate (input types only; ranges are the domain)', () => {
  it('accepts a full body', () => {
    expect(parseNewTemplate(VALID)).toEqual(VALID)
  })

  it('accepts no schedule, no deadline and a schedule without a time', () => {
    expect(parseNewTemplate({ ...VALID, schedule: null, deadline: null })).toEqual({
      ...VALID,
      schedule: null,
      deadline: null,
    })
    expect(parseNewTemplate({ ...VALID, schedule: { days: [0], time: null } }).schedule).toEqual({
      days: [0],
      time: null,
    })
  })

  it('passes out-of-range numbers on to the domain', () => {
    expect(parseNewTemplate({ ...VALID, schedule: { days: [9], time: null } }).schedule).toEqual({
      days: [9],
      time: null,
    })
  })

  it.each([
    ['a string score', { score: '4' }],
    ['days as a string', { schedule: { days: '2', time: null } }],
    ['8 days', { schedule: { days: [0, 1, 2, 3, 4, 5, 6, 0], time: null } }],
    ['a missing deadline key', { deadline: undefined }],
    ['a nested string hour', { schedule: { days: [2], time: { hour: '18', minute: 0 } } }],
    ['a deadline without grace', { deadline: { dayOffset: 1, due: { hour: 7, minute: 0 } } }],
    ['a non-boolean flag', { approvalRequired: 'yes' }],
    ['a fractional day', { schedule: { days: [1.5], time: null } }],
  ])('throws on %s', (_, change) => {
    expect(() => parseNewTemplate({ ...VALID, ...change })).toThrow('Invalid input')
  })

  it('throws on a non-object body', () => {
    expect(() => parseNewTemplate(null)).toThrow('Invalid input')
    expect(() => parseNewTemplate('x')).toThrow('Invalid input')
  })
})

describe('parseTemplateId', () => {
  it('accepts a whole-number id', () => {
    expect(parseTemplateId({ templateId: 3 })).toEqual({ templateId: 3 })
  })

  it.each([
    ['a string', { templateId: '1' }],
    ['a fraction', { templateId: 1.5 }],
    ['no id', {}],
    ['null', null],
  ])('refuses %s', (_, body) => {
    expect(() => parseTemplateId(body)).toThrow('Invalid input')
  })
})

describe('parseApproval', () => {
  it('takes a score up to 999 and refuses 1000', () => {
    expect(parseApproval({ templateId: 1, score: 999 })).toEqual({ templateId: 1, score: 999 })
    expect(() => parseApproval({ templateId: 1, score: 1000 })).toThrow('Invalid input')
  })
})

describe('parseTemplateTurnDown (#209)', () => {
  const bids = (n: number) => Array.from({ length: n }, (_, i) => ({ takerId: i + 1, score: 5 }))

  it('takes 1 to 20 bids, one per taker', () => {
    expect(parseTemplateTurnDown({ templateId: 3, bids: bids(1) })).toEqual({
      templateId: 3,
      bids: [{ takerId: 1, score: 5 }],
    })
    expect(parseTemplateTurnDown({ templateId: 3, bids: bids(20) }).bids).toHaveLength(20)
  })

  it.each([
    ['21 bids', { templateId: 3, bids: bids(21) }],
    ['no bids', { templateId: 3, bids: [] }],
    ['bids not a list', { templateId: 3, bids: 'x' }],
    [
      'two bids of one taker',
      {
        templateId: 3,
        bids: [
          { takerId: 1, score: 5 },
          { takerId: 1, score: 6 },
        ],
      },
    ],
    ['a 0 score', { templateId: 3, bids: [{ takerId: 1, score: 0 }] }],
    ['a 1000 score', { templateId: 3, bids: [{ takerId: 1, score: 1000 }] }],
    ['a missing templateId', { bids: bids(1) }],
    ['a string takerId', { templateId: 3, bids: [{ takerId: '1', score: 5 }] }],
  ])('refuses %s', (_, body) => {
    expect(() => parseTemplateTurnDown(body)).toThrow('Invalid input')
  })
})

describe('template score handlers on a proposed chore (#209, switch choreBidding)', () => {
  const withSwitch = (enabled: boolean) => {
    const f = family()
    f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'choreBidding')).run()
    const input = { title: 'Vynést koš', score: 10, approvalRequired: true }
    const id = must(
      createTemplate(f.db, f.tata, { ...input, schedule: null, deadline: null }, T0),
    ).id
    return { f, id }
  }

  it('off: each handler answers not_agreed and writes nothing', () => {
    const { f, id } = withSwitch(false)
    const at = { templateId: id, score: 12 }
    const off = { ok: false, error: 'not_agreed' }
    expect(bidTemplateScoreHandler(f.db, f.starsi, at, T1)).toEqual(off)
    expect(counterTemplateScoreHandler(f.db, f.tata, at, T1)).toEqual(off)
    expect(acceptTemplateBidHandler(f.db, f.tata, at, T1)).toEqual(off)
    expect(acceptTemplateOfferHandler(f.db, f.starsi, { templateId: id, score: 10 }, T1)).toEqual(
      off,
    )
    expect(withdrawTemplateBidHandler(f.db, f.starsi, { templateId: id }, T1)).toEqual(off)
    const bids = [{ takerId: f.starsi, score: 12 }]
    expect(turnDownTemplateBidsHandler(f.db, f.tata, { templateId: id, bids }, T1)).toEqual(off)
    expect(threadRows(f.db, id)).toEqual([])
  })

  it('on: a bid answers exactly ok, id and the score 10', () => {
    const { f, id } = withSwitch(true)
    expect(bidTemplateScoreHandler(f.db, f.starsi, { templateId: id, score: 12 }, T1)).toEqual({
      ok: true,
      id,
      score: 10,
    })
  })

  it("on: Nechci closes Starší's bid; a turn-down with the bids he saw closes the rest", () => {
    const { f, id } = withSwitch(true)
    expect(bidTemplateScoreHandler(f.db, f.starsi, { templateId: id, score: 12 }, T1).ok).toBe(true)
    expect(bidTemplateScoreHandler(f.db, f.mladsi, { templateId: id, score: 14 }, T1).ok).toBe(true)
    expect(withdrawTemplateBidHandler(f.db, f.starsi, { templateId: id }, T2)).toEqual({
      ok: true,
      id,
      score: 10,
    })
    const bids = [{ takerId: f.mladsi, score: 14 }]
    expect(turnDownTemplateBidsHandler(f.db, f.tata, { templateId: id, bids }, T2)).toEqual({
      ok: true,
      id,
      score: 10,
    })
    expect(threadRows(f.db, id)).toEqual([
      ['taker', f.starsi, 12, 'closed'],
      ['taker', f.mladsi, 14, 'closed'],
      ['giver', f.tata, 10, null],
    ])
  })

  it('on: accepting the lowest answers the agreed score', () => {
    const { f, id } = withSwitch(true)
    expect(bidTemplateScoreHandler(f.db, f.starsi, { templateId: id, score: 12 }, T1).ok).toBe(true)
    expect(acceptTemplateBidHandler(f.db, f.tata, { templateId: id, score: 12 }, T2)).toEqual({
      ok: true,
      id,
      score: 12,
    })
  })
})
