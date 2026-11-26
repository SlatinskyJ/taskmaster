import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { Db } from '~/server/db'
import { auditLog, templates, templateScoreApprovals, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { updateUser } from '~/server/users/manage'
import type { NewTemplate } from './templates'
import { addEntry } from './thread'
import {
  agreementOf,
  approveTemplateScore,
  createTemplate,
  getTemplateDetail,
  listTemplates,
  pendingTemplateApprovals,
  pendingTemplatePriceChanges,
} from './templates'
import { acceptOfferOnTemplate, bidOnTemplate, counterOnTemplate } from './scoreChange'

const T0 = new Date('2026-11-18T10:00:00.000Z')
const T1 = new Date('2026-11-18T11:00:00.000Z')
const T2 = new Date('2026-11-18T12:00:00.000Z')

function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

/** Admin, Táta and Máma (givers), the two brothers (takers). */
function family() {
  const db = createTestDb()
  const add = (username: string, displayName: string, role: 'admin' | 'giver' | 'taker') =>
    db
      .insert(users)
      .values({
        username,
        displayName,
        role,
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      })
      .returning()
      .get().id
  return {
    db,
    admin: add('admin', 'Admin', 'admin'),
    tata: add('tata', 'Táta', 'giver'),
    mama: add('mama', 'Máma', 'giver'),
    starsi: add('starsi', 'Starší', 'taker'),
    mladsi: add('mladsi', 'Mladší', 'taker'),
  }
}

const audit = (db: Db) =>
  db
    .select({
      action: auditLog.action,
      actor: auditLog.actorUserId,
      kind: auditLog.actorKind,
      before: auditLog.before,
      after: auditLog.after,
    })
    .from(auditLog)
    .where(eq(auditLog.entityType, 'template'))
    .all()

const BINS: NewTemplate = {
  title: 'Vynést koše',
  score: 4,
  approvalRequired: true,
  schedule: { days: [2], time: { hour: 18, minute: 0 } },
  deadline: { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 120 },
}
const DISHES: NewTemplate = {
  title: 'Vyndat myčku',
  score: 3,
  approvalRequired: false,
  schedule: null,
  deadline: null,
}

describe('createTemplate (spec §5.1, §5.3)', () => {
  it('a giver creates a proposed template; proposing counts as approving', () => {
    const { db, tata } = family()
    const row = must(createTemplate(db, tata, BINS, T0))
    expect(row).toMatchObject({
      title: 'Vynést koše',
      status: 'proposed',
      score: 4,
      agreedAt: null,
    })
    expect(db.select().from(templateScoreApprovals).all()).toEqual([
      { templateId: row.id, userId: tata, score: 4, offerRound: 1, approvedAt: T0.toISOString() },
    ])
    expect(audit(db).map((a) => [a.action, a.actor])).toEqual([['template.created', tata]])
  })

  it('round-trips Sunday, Saturday, minutes and the grace through storage', () => {
    const { db, tata } = family()
    must(
      createTemplate(
        db,
        tata,
        {
          ...BINS,
          schedule: { days: [6, 0, 3], time: { hour: 18, minute: 30 } },
          deadline: { dayOffset: 1, due: { hour: 7, minute: 45 }, graceMinutes: 90 },
        },
        T0,
      ),
    )
    must(createTemplate(db, tata, DISHES, T0))
    must(
      createTemplate(
        db,
        tata,
        { ...DISHES, title: 'Zalít kytky', schedule: { days: [1], time: null } },
        T0,
      ),
    )
    const [flowers, dishes, bins] = listTemplates(db, tata)
    expect(bins).toMatchObject({
      schedule: { days: [0, 3, 6], time: '18:30' },
      deadline: { dayOffset: 1, due: '07:45', graceMinutes: 90 },
    })
    expect(dishes).toMatchObject({ schedule: null, deadline: null })
    expect(flowers).toMatchObject({ schedule: { days: [1], time: null }, deadline: null })
  })

  it.each([
    ['taker', 'starsi'],
    ['admin', 'admin'],
  ] as const)('a %s may not create one', (_, who) => {
    const f = family()
    expect(createTemplate(f.db, f[who], BINS, T0)).toEqual({ ok: false, error: 'not_a_giver' })
    expect(f.db.select().from(templates).all()).toEqual([])
    expect(audit(f.db)).toEqual([])
  })

  it.each([
    ['blank title', { title: '   ' }, 'invalid_title'],
    ['81-char title', { title: 'x'.repeat(81) }, 'invalid_title'],
    ['score 0', { score: 0 }, 'invalid_score'],
    ['score 1.5', { score: 1.5 }, 'invalid_score'],
    ['no days', { schedule: { days: [], time: null } }, 'invalid_schedule'],
    [
      'grace over 48 h',
      { deadline: { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 2881 } },
      'invalid_deadline',
    ],
  ] as const)('refuses a %s, writing nothing', (_, change, error) => {
    const { db, tata } = family()
    expect(createTemplate(db, tata, { ...BINS, ...change }, T0)).toEqual({
      ok: false,
      error,
    })
    expect(db.select().from(templates).all()).toEqual([])
    expect(db.select().from(templateScoreApprovals).all()).toEqual([])
    expect(audit(db)).toEqual([])
  })
})

describe('approveTemplateScore (spec §3 score agreement)', () => {
  it("a taker's yes agrees it: active, audited with before and after", () => {
    const { db, tata, starsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    const row = must(approveTemplateScore(db, starsi, id, 4, T1))
    expect(row).toMatchObject({ status: 'active', agreedAt: T1.toISOString(), score: 4 })
    const entries = audit(db)
    expect(entries.map((a) => [a.action, a.actor])).toEqual([
      ['template.created', tata],
      ['template.score_approved', starsi],
      ['template.agreed', starsi],
    ])
    expect(JSON.parse(entries[1]?.after ?? 'null')).toEqual({ score: 4, offerRound: 1 })
    expect(JSON.parse(entries[2]?.before ?? 'null')).toEqual({
      status: 'proposed',
      score: 4,
      bidsFrom: 0,
    })
    expect(JSON.parse(entries[2]?.after ?? 'null')).toEqual({
      status: 'active',
      score: 4,
      by: 'approval',
      entryIds: [],
      closedIds: [],
      bidsFrom: 0,
    })
  })

  it("a second giver's yes alone keeps it proposed", () => {
    const { db, tata, mama } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    expect(must(approveTemplateScore(db, mama, id, 4, T1)).status).toBe('proposed')
  })

  it('the admin is never a party', () => {
    const { db, tata, admin } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    expect(approveTemplateScore(db, admin, id, 4, T1)).toEqual({ ok: false, error: 'not_a_party' })
  })

  it.each([
    ['a score that is not the stored one', 'offer_changed'],
    ['an unknown template', 'not_found'],
    ['the same person twice', 'already_approved'],
    ['a template already agreed', 'not_proposed'],
  ] as const)('refuses %s, writing nothing', (what, error) => {
    const { db, tata, starsi, mladsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    let call = () => approveTemplateScore(db, starsi, id, 5, T1)
    if (what === 'an unknown template') call = () => approveTemplateScore(db, starsi, 999, 4, T1)
    if (what === 'the same person twice') call = () => approveTemplateScore(db, tata, id, 4, T1)
    if (what === 'a template already agreed') {
      must(approveTemplateScore(db, starsi, id, 4, T1))
      call = () => approveTemplateScore(db, mladsi, id, 4, T2)
    }
    const before = { rows: db.select().from(templateScoreApprovals).all(), log: audit(db) }
    expect(call()).toEqual({ ok: false, error })
    expect(db.select().from(templateScoreApprovals).all()).toEqual(before.rows)
    expect(audit(db)).toEqual(before.log)
  })

  it('approvals count live: the proposing giver left, so a taker alone is not enough', () => {
    const { db, admin, tata, mama, starsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    must(updateUser(db, { kind: 'user', userId: admin }, tata, { active: false }, T0))
    expect(must(approveTemplateScore(db, starsi, id, 4, T1)).status).toBe('proposed')
    expect(must(approveTemplateScore(db, mama, id, 4, T2)).status).toBe('active')
  })

  it('rolls back the approval and the agreement when the audit write fails', () => {
    const { db, tata, starsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    db.$client.exec(
      `CREATE TRIGGER fail_agreed BEFORE INSERT ON audit_log WHEN NEW.action = 'template.agreed'
       BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
    )
    expect(() => approveTemplateScore(db, starsi, id, 4, T1)).toThrow(/audit down/)
    expect(db.select().from(templates).get()).toMatchObject({ status: 'proposed', agreedAt: null })
    expect(db.select().from(templateScoreApprovals).all()).toHaveLength(1)
    expect(audit(db).map((a) => a.action)).toEqual(['template.created'])
  })
})

describe('a proposed template read for bidding (#209)', () => {
  it("agreementOf reads a proposed template's offer, bids and last bids from its thread", () => {
    const { db, tata, mama, starsi, mladsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    db.transaction((tx) => {
      addEntry(tx, { templateId: id, userId: starsi, side: 'taker', score: 6 }, T1)
      addEntry(tx, { templateId: id, userId: mama, side: 'giver', score: 5 }, T1)
      addEntry(tx, { templateId: id, userId: mladsi, side: 'taker', score: 7 }, T1)
    })
    const row = db.select().from(templates).where(eq(templates.id, id)).get()
    if (!row) throw new Error('no row')
    expect(agreementOf(db, row)).toEqual({
      status: 'proposed',
      proposal: { score: 4, proposedBy: mama, approvedBy: [tata] },
      book: {
        bids: [
          { by: starsi, score: 6 },
          { by: mladsi, score: 7 },
        ],
      },
      lastBids: [{ by: mladsi, score: 7 }],
    })
  })

  it('approvals count only in the current offer round', () => {
    const { db, tata, mama } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    db.update(templates).set({ offerRound: 2, score: 5 }).where(eq(templates.id, id)).run()
    db.insert(templateScoreApprovals)
      .values({
        templateId: id,
        userId: mama,
        score: 5,
        offerRound: 2,
        approvedAt: T1.toISOString(),
      })
      .run()
    const row = db.select().from(templates).where(eq(templates.id, id)).get()
    if (!row) throw new Error('no row')
    const agreement = agreementOf(db, row)
    expect(agreement.status === 'proposed' && agreement.proposal.approvedBy).toEqual([mama])
    expect(listTemplates(db, tata).find((t) => t.id === id)?.approvedBy).toEqual(['Máma'])
  })
})

describe('resolveProposedTemplates (people changed)', () => {
  it('agrees a proposed template through the real people-change hook, logged as the system', () => {
    const { db, admin, tata, mama } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    // Máma approved as a giver; the admin turns her into a taker: now a giver and a taker agree.
    must(approveTemplateScore(db, mama, id, 4, T1))
    must(updateUser(db, { kind: 'user', userId: admin }, mama, { role: 'taker' }, T2))
    expect(db.select().from(templates).get()).toMatchObject({
      status: 'active',
      agreedAt: T2.toISOString(),
    })
    expect(audit(db).at(-1)).toMatchObject({ action: 'template.agreed', kind: 'system' })
  })
})

describe('reads', () => {
  it('pins the TemplateView shape (no ids of people, nothing else)', () => {
    const { db, tata } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    const list = listTemplates(db, tata)
    expect(list).toEqual([
      {
        id,
        title: 'Vynést koše',
        description: null,
        status: 'proposed',
        score: 4,
        approvalRequired: true,
        createdByName: 'Táta',
        approvedBy: ['Táta'],
        schedule: { days: [2], time: '18:00' },
        deadline: { dayOffset: 1, due: '07:00', graceMinutes: 120 },
        change: null,
        bidding: null,
        lastBids: [],
      },
    ])
    expect(Object.keys(list[0] ?? {}).sort()).toEqual(
      [
        'approvalRequired',
        'approvedBy',
        'bidding',
        'change',
        'createdByName',
        'deadline',
        'description',
        'id',
        'lastBids',
        'schedule',
        'score',
        'status',
        'title',
      ].sort(),
    )
  })

  it("a proposed template's view has its bidding (#209); an agreed one has bidding null", () => {
    const { db, tata, mama, starsi, mladsi } = family()
    const bratranec = db
      .insert(users)
      .values({
        username: 'bratranec',
        displayName: 'Bratranec',
        role: 'taker',
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      })
      .returning()
      .get().id
    const { id } = must(createTemplate(db, tata, BINS, T0))
    const on = { choreBidding: true, bidRefusals: false }
    must(bidOnTemplate(db, starsi, id, 7, T1, on))
    must(bidOnTemplate(db, mladsi, id, 6, T1, on))
    must(counterOnTemplate(db, mama, id, 5, T1, on))
    must(bidOnTemplate(db, mladsi, id, 8, T2, on))
    must(bidOnTemplate(db, bratranec, id, 6, T2, on))
    const view = () => listTemplates(db, tata, on).find((t) => t.id === id)
    expect(view()?.bidding).toEqual({
      offer: { score: 5, byName: 'Máma' },
      bids: [
        { takerId: bratranec, name: 'Bratranec', score: 6 },
        { takerId: starsi, name: 'Starší', score: 7 },
        { takerId: mladsi, name: 'Mladší', score: 8 },
      ],
      lowest: 6,
      lastBids: [
        { takerId: mladsi, score: 8 },
        { takerId: bratranec, score: 6 },
      ],
    })
    must(approveTemplateScore(db, starsi, id, 5, T2))
    expect(view()).toMatchObject({ status: 'active', bidding: null, change: null })
  })

  it('a proposed chore has bidding only with choreBidding on, in every read (#209)', () => {
    const { db, tata, starsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    const on = { choreBidding: true, bidRefusals: false }
    must(bidOnTemplate(db, starsi, id, 6, T1, on))
    const off = { choreBidding: false, bidRefusals: false }
    for (const opts of [off, undefined]) {
      expect(listTemplates(db, tata, opts)[0]?.bidding).toBeNull()
      expect(getTemplateDetail(db, id, tata, opts)?.template.bidding).toBeNull()
      expect(pendingTemplateApprovals(db, starsi, opts)[0]?.bidding).toBeNull()
    }
    expect(listTemplates(db, tata, on)[0]?.bidding?.lowest).toBe(6)
    expect(getTemplateDetail(db, id, tata, on)?.template.bidding?.lowest).toBe(6)
    expect(pendingTemplateApprovals(db, starsi, on)[0]?.bidding?.lowest).toBe(6)
  })

  it("a brother opens a proposed chore's page only with choreBidding on; an admin always (#209, #222)", () => {
    const { db, admin, tata, starsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    const on = { choreBidding: true, bidRefusals: false }
    expect(getTemplateDetail(db, id, starsi)).toBeNull()
    expect(
      getTemplateDetail(db, id, starsi, { choreBidding: false, bidRefusals: false }),
    ).toBeNull()
    expect(getTemplateDetail(db, id, starsi, on)?.template.id).toBe(id)
    // disputes gates the admin in getTemplateDetailFn, not here.
    expect(getTemplateDetail(db, id, admin)?.template.id).toBe(id)
  })

  it("a parent's Vyjednávání takes a proposed chore with bids only with the switch on (#209)", () => {
    const { db, tata, starsi } = family()
    const on = { choreBidding: true, bidRefusals: false }
    const withBid = must(createTemplate(db, tata, BINS, T0)).id
    must(createTemplate(db, tata, { ...BINS, title: 'Zalít kytky' }, T0))
    const agreed = must(createTemplate(db, tata, DISHES, T0)).id
    must(approveTemplateScore(db, starsi, agreed, 3, T0))
    must(bidOnTemplate(db, starsi, agreed, 5, T1))
    must(bidOnTemplate(db, starsi, withBid, 6, T1, on))
    expect(pendingTemplatePriceChanges(db, tata, on).map((t) => t.id)).toEqual([agreed, withBid])
    expect(pendingTemplatePriceChanges(db, tata).map((t) => t.id)).toEqual([agreed])
    expect(pendingTemplatePriceChanges(db, starsi, on)).toEqual([])
  })

  it('pending approvals: takers until they approve, givers only when no current giver has', () => {
    const { db, admin, tata, mama, starsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    expect(pendingTemplateApprovals(db, starsi).map((t) => t.id)).toEqual([id])
    expect(pendingTemplateApprovals(db, mama)).toEqual([])
    expect(pendingTemplateApprovals(db, admin)).toEqual([])
    must(updateUser(db, { kind: 'user', userId: admin }, tata, { active: false }, T1))
    expect(pendingTemplateApprovals(db, mama).map((t) => t.id)).toEqual([id])
    expect(pendingTemplateApprovals(db, tata)).toEqual([])
  })

  it('a taker no longer sees it after his own yes, while it waits for a giver', () => {
    const { db, admin, tata, mama, starsi } = family()
    const { id } = must(createTemplate(db, tata, BINS, T0))
    must(updateUser(db, { kind: 'user', userId: admin }, tata, { active: false }, T0))
    expect(must(approveTemplateScore(db, starsi, id, 4, T1)).status).toBe('proposed')
    expect(pendingTemplateApprovals(db, starsi)).toEqual([])
    expect(pendingTemplateApprovals(db, mama).map((t) => t.id)).toEqual([id])
  })

  it('a giver sees every template, a taker only agreed ones', () => {
    const { db, tata, starsi } = family()
    const bins = must(createTemplate(db, tata, BINS, T0)).id
    const dishes = must(createTemplate(db, tata, DISHES, T0)).id
    must(approveTemplateScore(db, starsi, dishes, DISHES.score, T0))
    expect(listTemplates(db, tata).map((t) => t.id)).toEqual([dishes, bins])
    expect(listTemplates(db, starsi).map((t) => t.id)).toEqual([dishes])
  })

  it('shows the change in flight: live bids lowest first, the offer, the lowest bid', () => {
    const { db, admin, tata, mama, starsi, mladsi } = family()
    const id = must(createTemplate(db, tata, DISHES, T0)).id
    must(approveTemplateScore(db, starsi, id, DISHES.score, T0))
    expect(listTemplates(db, tata)[0]?.change).toBeNull()
    must(bidOnTemplate(db, mladsi, id, 7, T1))
    must(bidOnTemplate(db, starsi, id, 5, T1))
    must(counterOnTemplate(db, mama, id, 6, T1))
    expect(listTemplates(db, starsi)[0]?.change).toEqual({
      offer: { score: 6, byName: 'Máma' },
      bids: [
        { takerId: starsi, name: 'Starší', score: 5 },
        { takerId: mladsi, name: 'Mladší', score: 7 },
      ],
      lowest: 5,
    })
    must(updateUser(db, { kind: 'user', userId: admin }, starsi, { active: false }, T2))
    expect(listTemplates(db, tata)[0]?.change).toEqual({
      offer: { score: 6, byName: 'Máma' },
      bids: [{ takerId: mladsi, name: 'Mladší', score: 7 }],
      lowest: 7,
    })
  })

  it('the detail keeps every offer and bid with names and closings, oldest first', () => {
    const { db, tata, starsi, mladsi } = family()
    const id = must(createTemplate(db, tata, DISHES, T0)).id
    must(approveTemplateScore(db, starsi, id, DISHES.score, T0))
    must(bidOnTemplate(db, mladsi, id, 7, T1))
    must(bidOnTemplate(db, mladsi, id, 6, T1))
    must(counterOnTemplate(db, tata, id, 5, T1))
    must(acceptOfferOnTemplate(db, starsi, id, 5, T2))
    const detail = getTemplateDetail(db, id, starsi)
    expect(detail?.template).toEqual(listTemplates(db, tata)[0])
    expect(detail?.template.change).toBeNull()
    const at = T1.toISOString()
    const entry = (by: number, name: string, score: number, state: string) => ({
      id: expect.any(Number) as number,
      side: by === tata ? 'giver' : 'taker',
      by: { id: by, name },
      score,
      at,
      state,
    })
    expect(detail?.thread).toEqual([
      entry(mladsi, 'Mladší', 7, 'replaced'),
      entry(mladsi, 'Mladší', 6, 'closed'),
      entry(tata, 'Táta', 5, 'accepted'),
    ])
  })
})

describe('template detail (price page)', () => {
  it('with openRows a brother gets a proposed template too (#205): he is a party who must agree; a giver gets both', () => {
    const { db, tata, starsi } = family()
    const id = must(createTemplate(db, tata, DISHES, T0)).id
    expect(getTemplateDetail(db, id, starsi)).toBeNull()
    expect(getTemplateDetail(db, id, starsi, undefined, true)?.template.status).toBe('proposed')
    expect(getTemplateDetail(db, id, tata)).toEqual({
      template: listTemplates(db, tata)[0],
      thread: [],
      waitingFor: [
        { id: starsi, name: 'Starší' },
        { id: expect.any(Number) as number, name: 'Mladší' },
      ],
      descriptionChange: null,
    })
    must(approveTemplateScore(db, starsi, id, DISHES.score, T0))
    expect(getTemplateDetail(db, id, starsi)?.template.status).toBe('active')
  })

  it("the admin reads it, proposed or agreed, as a giver does (#222; the switch is the server function's)", () => {
    const { db, admin, tata, starsi } = family()
    const id = must(createTemplate(db, tata, DISHES, T0)).id
    expect(getTemplateDetail(db, id, admin)).toEqual(getTemplateDetail(db, id, tata))
    must(approveTemplateScore(db, starsi, id, DISHES.score, T0))
    expect(getTemplateDetail(db, id, admin)).toEqual(getTemplateDetail(db, id, tata))
    expect(getTemplateDetail(db, id, admin)?.template.status).toBe('active')
  })

  it('waitingFor: both brothers until one agrees, then nobody; Máma never (Táta’s yes is the givers’)', () => {
    const { db, tata, mama, starsi, mladsi } = family()
    const id = must(createTemplate(db, tata, BINS, T0)).id
    const waits = (viewer: number) => getTemplateDetail(db, id, viewer, undefined, true)?.waitingFor
    expect(waits(starsi)).toEqual([
      { id: starsi, name: 'Starší' },
      { id: mladsi, name: 'Mladší' },
    ])
    expect(waits(mama)?.map((p) => p.id)).not.toContain(mama)
    // Domů asks the same people: the page and "Čeká na tebe" agree by id.
    for (const who of [tata, mama, starsi, mladsi])
      expect(pendingTemplateApprovals(db, who).some((t) => t.id === id)).toBe(
        waits(who)?.some((p) => p.id === who) ?? false,
      )
    must(approveTemplateScore(db, starsi, id, BINS.score, T1))
    expect(waits(mladsi)).toEqual([])
  })

  it('an unknown id gives null', () => {
    const { db, tata } = family()
    expect(getTemplateDetail(db, 999, tata)).toBeNull()
  })
})

describe('"Čeká na tebe": template price changes', () => {
  function agreed() {
    const f = family()
    const id = must(createTemplate(f.db, f.tata, DISHES, T0)).id
    must(approveTemplateScore(f.db, f.starsi, id, DISHES.score, T0))
    const ids = (userId: number) => pendingTemplatePriceChanges(f.db, userId).map((t) => t.id)
    return { ...f, id, ids }
  }

  it('an open offer waits for every taker, live bids for every giver', () => {
    const f = agreed()
    must(bidOnTemplate(f.db, f.mladsi, f.id, 5, T1))
    must(counterOnTemplate(f.db, f.tata, f.id, 4, T1))
    expect(f.ids(f.starsi)).toEqual([f.id])
    expect(f.ids(f.mladsi)).toEqual([f.id])
    expect(f.ids(f.tata)).toEqual([f.id])
    expect(f.ids(f.mama)).toEqual([f.id])
    expect(f.ids(f.admin)).toEqual([])
  })

  it('only an offer: takers yes, givers no', () => {
    const f = agreed()
    must(counterOnTemplate(f.db, f.tata, f.id, 4, T1))
    expect(f.ids(f.starsi)).toEqual([f.id])
    expect(f.ids(f.tata)).toEqual([])
  })

  it('only bids: givers yes, takers no', () => {
    const f = agreed()
    must(bidOnTemplate(f.db, f.mladsi, f.id, 5, T1))
    expect(f.ids(f.tata)).toEqual([f.id])
    expect(f.ids(f.starsi)).toEqual([])
    expect(f.ids(f.mladsi)).toEqual([])
  })

  it('no change or a proposed template: nobody', () => {
    const f = agreed()
    must(createTemplate(f.db, f.tata, { ...DISHES, title: 'Vynést koš' }, T0))
    for (const who of [f.tata, f.mama, f.starsi, f.mladsi]) expect(f.ids(who)).toEqual([])
  })
})
