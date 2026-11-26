import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { featureFlags } from '~/server/db/schema'
import { ForbiddenError } from '~/server/auth/guards'
import { family, must, T0, T1, T2 } from '~/server/tasks/testing'
import {
  acceptTemplateBidHandler,
  acceptTemplateOfferHandler,
  bidTemplateScoreHandler,
  counterTemplateScoreHandler,
  turnDownTemplateBidsHandler,
  templateDetailHandler,
  withdrawTemplateBidHandler,
} from './functions'
import {
  parseApproval,
  parseNewTemplate,
  parseSeenApproval,
  parseSeenScore,
  parseTemplateId,
  parseTemplateTurnDown,
  seenStatusOf,
} from './parse'
import { approveTemplateScore, createTemplate } from './templates'
import { threadRows } from './testing'
import {
  pendingTemplateApprovalsRead,
  pendingTemplatePriceChangesRead,
  templateDetailRead,
  templatesRead,
} from './functions'

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

describe('the status a price call saw (#243)', () => {
  it('seenStatusOf: none, proposed or active', () => {
    expect(seenStatusOf({})).toEqual({})
    expect(seenStatusOf({ seenStatus: 'proposed' })).toEqual({ seenStatus: 'proposed' })
    expect(seenStatusOf({ seenStatus: 'active' })).toEqual({ seenStatus: 'active' })
  })

  it.each([['done'], [1], [null], ['']])('seenStatusOf refuses %j', (seenStatus) => {
    expect(() => seenStatusOf({ seenStatus })).toThrow('Invalid input')
  })

  it('parseSeenScore and parseSeenApproval carry it; without it, none', () => {
    const body = { templateId: 1, score: 6, seenStatus: 'proposed' }
    expect(parseSeenScore(body)).toEqual(body)
    expect(parseSeenApproval(body)).toEqual(body)
    expect(parseSeenApproval({ templateId: 1, score: 6 })).toEqual({ templateId: 1, score: 6 })
    expect(() => parseSeenScore({ templateId: 1, score: 6, seenStatus: 'done' })).toThrow(
      'Invalid input',
    )
  })

  it.each([
    ['a 1000 score', { templateId: 1, score: 1000 }],
    ['a string score', { templateId: 1, score: '6' }],
    ['no templateId', { score: 6 }],
    ['a bad status', { templateId: 1, score: 6, seenStatus: 'done' }],
    ['null', null],
  ])('parseSeenApproval refuses %s', (_, body) => {
    expect(() => parseSeenApproval(body)).toThrow('Invalid input')
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
    expect(parseTemplateTurnDown({ templateId: 3, bids: [{ takerId: 1, score: 1 }] }).bids).toEqual(
      [{ takerId: 1, score: 1 }],
    )
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
      status: 'proposed',
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
      status: 'proposed',
    })
    const bids = [{ takerId: f.mladsi, score: 14 }]
    expect(turnDownTemplateBidsHandler(f.db, f.tata, { templateId: id, bids }, T2)).toEqual({
      ok: true,
      id,
      score: 10,
      status: 'proposed',
    })
    expect(threadRows(f.db, id)).toEqual([
      ['taker', f.starsi, 12, 'closed'],
      ['taker', f.mladsi, 14, 'closed'],
      ['giver', f.tata, 10, null],
    ])
  })

  it('on: a counter answers status proposed at its offer', () => {
    const { f, id } = withSwitch(true)
    expect(counterTemplateScoreHandler(f.db, f.tata, { templateId: id, score: 11 }, T1)).toEqual({
      ok: true,
      id,
      score: 11,
      status: 'proposed',
    })
  })

  it('on: accepting the lowest answers the agreed score', () => {
    const { f, id } = withSwitch(true)
    expect(bidTemplateScoreHandler(f.db, f.starsi, { templateId: id, score: 12 }, T1).ok).toBe(true)
    expect(acceptTemplateBidHandler(f.db, f.tata, { templateId: id, score: 12 }, T2)).toEqual({
      ok: true,
      id,
      score: 12,
      status: 'active',
    })
  })
})

describe('a price call whose chore went active meanwhile is offer_changed (#243)', () => {
  /** Starší bid 6 on the proposed chore; Mladší's Souhlasím then made it active at 10. */
  const wentActive = () => {
    const f = family()
    f.db
      .update(featureFlags)
      .set({ enabled: true })
      .where(eq(featureFlags.key, 'choreBidding'))
      .run()
    const input = { title: 'Vynést koš', score: 10, approvalRequired: true }
    const id = must(
      createTemplate(f.db, f.tata, { ...input, schedule: null, deadline: null }, T0),
    ).id
    expect(bidTemplateScoreHandler(f.db, f.starsi, { templateId: id, score: 6 }, T1).ok).toBe(true)
    must(approveTemplateScore(f.db, f.mladsi, id, 10, T1))
    return { f, id }
  }

  type F = ReturnType<typeof wentActive>
  type Call = (
    f: F['f'],
    data: { templateId: number; score: number; seenStatus: 'proposed' | 'active' },
  ) => { ok: boolean }

  // [name, the step before (on the active chore), the call, its score]
  const cases: [string, (f: F['f'], id: number) => void, Call, number][] = [
    ['counter', () => undefined, (f, d) => counterTemplateScoreHandler(f.db, f.tata, d, T2), 6],
    ['bid', () => undefined, (f, d) => bidTemplateScoreHandler(f.db, f.mladsi, d, T2), 7],
    [
      'accept bid',
      (f, id) => {
        expect(bidTemplateScoreHandler(f.db, f.mladsi, { templateId: id, score: 7 }, T1).ok).toBe(
          true,
        )
      },
      (f, d) => acceptTemplateBidHandler(f.db, f.tata, d, T2),
      7,
    ],
    [
      'accept offer',
      (f, id) => {
        expect(counterTemplateScoreHandler(f.db, f.tata, { templateId: id, score: 8 }, T1).ok).toBe(
          true,
        )
      },
      (f, d) => acceptTemplateOfferHandler(f.db, f.starsi, d, T2),
      8,
    ],
  ]

  it.each(cases)(
    '%s: sent seeing proposed is refused, nothing written; seeing active it runs',
    (_, before, call, score) => {
      const { f, id } = wentActive()
      before(f, id)
      const rows = threadRows(f.db, id)
      expect(call(f, { templateId: id, score, seenStatus: 'proposed' })).toEqual({
        ok: false,
        error: 'offer_changed',
      })
      expect(threadRows(f.db, id)).toEqual(rows)
      expect(call(f, { templateId: id, score, seenStatus: 'active' }).ok).toBe(true)
    },
  )
})

describe('Nechci and turn-down handlers on a price change (#232, switch bidRefusals)', () => {
  const withSwitch = (enabled: boolean) => {
    const f = family()
    f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'bidRefusals')).run()
    const input = { title: 'Umýt koupelnu', score: 8, approvalRequired: true }
    const id = must(
      createTemplate(f.db, f.tata, { ...input, schedule: null, deadline: null }, T0),
    ).id
    must(approveTemplateScore(f.db, f.starsi, id, 8, T0))
    expect(bidTemplateScoreHandler(f.db, f.starsi, { templateId: id, score: 10 }, T1).ok).toBe(true)
    expect(bidTemplateScoreHandler(f.db, f.mladsi, { templateId: id, score: 11 }, T1).ok).toBe(true)
    return { f, id }
  }

  it('off: both answer not_proposed and write nothing', () => {
    const { f, id } = withSwitch(false)
    const off = { ok: false, error: 'not_proposed' }
    expect(withdrawTemplateBidHandler(f.db, f.starsi, { templateId: id }, T2)).toEqual(off)
    const bids = [{ takerId: f.mladsi, score: 11 }]
    expect(turnDownTemplateBidsHandler(f.db, f.tata, { templateId: id, bids }, T2)).toEqual(off)
    expect(threadRows(f.db, id)).toEqual([
      ['taker', f.starsi, 10, null],
      ['taker', f.mladsi, 11, null],
    ])
  })

  it('on: Nechci and a turn-down answer exactly ok, id, the old score 8 and active', () => {
    const { f, id } = withSwitch(true)
    const kept = { ok: true, id, score: 8, status: 'active' }
    expect(withdrawTemplateBidHandler(f.db, f.starsi, { templateId: id }, T2)).toEqual(kept)
    const bids = [{ takerId: f.mladsi, score: 11 }]
    // No parent offer yet: nothing to turn down to (Jakub 2026-11-26).
    expect(turnDownTemplateBidsHandler(f.db, f.tata, { templateId: id, bids }, T2)).toEqual({
      ok: false,
      error: 'no_offer',
    })
    expect(counterTemplateScoreHandler(f.db, f.tata, { templateId: id, score: 9 }, T2).ok).toBe(
      true,
    )
    expect(turnDownTemplateBidsHandler(f.db, f.tata, { templateId: id, bids }, T2)).toEqual(kept)
    expect(threadRows(f.db, id)).toEqual([
      ['taker', f.starsi, 10, 'closed'],
      ['taker', f.mladsi, 11, 'closed'],
      ['giver', f.tata, 9, 'replaced'],
      ['giver', f.tata, 9, null],
    ])
  })
})

describe("the admin reads a chore's page only while disputes is on (#222)", () => {
  const withDisputes = (enabled: boolean) => {
    const f = family()
    f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, 'disputes')).run()
    const input = { title: 'Vynést koš', score: 4, approvalRequired: true }
    const id = must(
      createTemplate(f.db, f.tata, { ...input, schedule: null, deadline: null }, T0),
    ).id
    return { f, id }
  }
  const admin = (f: ReturnType<typeof family>) => ({ id: f.admin, role: 'admin' as const })
  it('off: the admin is refused; a giver still reads it', () => {
    const { f, id } = withDisputes(false)
    expect(() => templateDetailHandler(f.db, admin(f), { templateId: id })).toThrow(ForbiddenError)
    expect(
      templateDetailHandler(f.db, { id: f.tata, role: 'giver' }, { templateId: id })?.template.id,
    ).toBe(id)
  })
  it('on: the admin reads a proposed chore, the same as a giver', () => {
    const { f, id } = withDisputes(true)
    expect(templateDetailHandler(f.db, admin(f), { templateId: id })).toEqual(
      templateDetailHandler(f.db, { id: f.tata, role: 'giver' }, { templateId: id }),
    )
  })
})

describe('topics (#299)', () => {
  const as = (id: number, role: 'giver' | 'taker' | 'admin') => ({
    id,
    username: role,
    displayName: role,
    role,
  })
  const setFlag = (f: ReturnType<typeof family>, key: string, enabled: boolean) =>
    f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, key)).run()
  const proposed = (f: ReturnType<typeof family>) =>
    must(
      createTemplate(
        f.db,
        f.tata,
        { title: 'Zalít kytky', score: 2, approvalRequired: true, schedule: null, deadline: null },
        T0,
      ),
    ).id

  it('the chore list: a giver holds templates and templates:proposed, a taker templates', () => {
    const f = family()
    expect(templatesRead.topics(as(f.tata, 'giver'), [], f.db)).toEqual([
      'templates',
      'templates:proposed',
    ])
    expect(templatesRead.topics(as(f.starsi, 'taker'), [], f.db)).toEqual(['templates'])
  })

  it("a taker's waiting proposed chores: templates:proposed, no per-row topics", () => {
    const f = family()
    const id = proposed(f)
    const starsi = as(f.starsi, 'taker')
    const rows = pendingTemplateApprovalsRead.read(f.db, starsi, undefined, T0)
    expect(rows.map((r) => r.id)).toEqual([id])
    expect(pendingTemplateApprovalsRead.topics(starsi, rows, f.db)).toEqual(['templates:proposed'])
    expect(pendingTemplateApprovalsRead.topics(as(f.tata, 'giver'), [], f.db)).toEqual([
      'templates:proposed',
    ])
  })

  it("a giver's price changes: templates:proposed only with choreBidding", () => {
    const f = family()
    const tata = as(f.tata, 'giver')
    setFlag(f, 'choreBidding', false)
    expect(pendingTemplatePriceChangesRead.topics(tata, [], f.db)).toEqual(['templates'])
    setFlag(f, 'choreBidding', true)
    expect(pendingTemplatePriceChangesRead.topics(tata, [], f.db)).toEqual([
      'templates',
      'templates:proposed',
    ])
    expect(pendingTemplatePriceChangesRead.topics(as(f.starsi, 'taker'), [], f.db)).toEqual([
      'templates',
    ])
  })

  it('the chore page: template:<id> for whoever loads it', () => {
    const f = family()
    setFlag(f, 'disputes', true)
    const id = proposed(f)
    must(approveTemplateScore(f.db, f.starsi, id, 2, T0))
    for (const viewer of [as(f.tata, 'giver'), as(f.starsi, 'taker'), as(f.admin, 'admin')]) {
      const detail = templateDetailRead.read(f.db, viewer, { templateId: id }, T0)
      expect(templateDetailRead.topics(viewer, detail, f.db)).toEqual([`template:${String(id)}`])
    }
  })

  it('a proposed chore a taker may not load: getTemplateDetail is null, no topics', () => {
    const f = family()
    setFlag(f, 'openRows', false)
    setFlag(f, 'choreBidding', false)
    const id = proposed(f)
    const starsi = as(f.starsi, 'taker')
    const detail = templateDetailRead.read(f.db, starsi, { templateId: id }, T0)
    expect(detail).toBeNull()
    expect(templateDetailRead.topics(starsi, detail, f.db)).toEqual([])
    expect(templateDetailRead.read(f.db, as(f.tata, 'giver'), { templateId: 999 }, T0)).toBeNull()
  })
})
