import { describe, expect, it, vi } from 'vitest'
import { historyText } from '~/components/tasks/historyText'
import type { FeatureKey } from '~/lib/features'
import { AUDIT_ACTIONS } from '~/server/audit'
import type { AuditAction, AuditLogRow } from '~/server/audit'
import { featureFlags } from '~/server/db/schema'
import type { EntityType } from '~/server/audit'
import { MEETING, week } from '~/server/settlement/testing'
import * as taskFns from '~/server/tasks/functions'
import type { HistoryEntry } from '~/server/tasks/functions'
import { car, must, T0 } from '~/server/tasks/testing'
import { createTemplate } from '~/server/templates/templates'
import { agreedTemplate } from '~/server/templates/testing'
import { MAPPED } from './mapping'
import { liveText, PHRASED } from './text'
import type { TitleCache, Viewer } from './text'

// A live event's sentence per viewer (#299, design "The event").

type F = ReturnType<typeof week>

let nextId = 1000
function entry(
  f: F,
  over: Partial<Omit<AuditLogRow, 'before' | 'after'>> & {
    before?: unknown
    after?: unknown
    by?: number | null
  },
): AuditLogRow {
  const { by = f.tata, before, after, ...rest } = over
  nextId += 1
  return {
    id: nextId,
    at: MEETING.toISOString(),
    actorKind: by === null ? 'system' : 'user',
    actorUserId: by,
    action: 'task.created',
    entityType: 'task',
    entityId: '0',
    before: before === undefined ? null : JSON.stringify(before),
    after: after === undefined ? null : JSON.stringify(after),
    reason: null,
    changeId: null,
    ...rest,
  }
}

function flag(f: F, key: FeatureKey, enabled: boolean): void {
  f.db
    .insert(featureFlags)
    .values({ key, enabled })
    .onConflictDoUpdate({ target: featureFlags.key, set: { enabled } })
    .run()
}

const giver = (f: F): Viewer => ({ id: f.tata, role: 'giver' })
const taker = (f: F, id = f.starsi): Viewer => ({ id, role: 'taker' })
const admin = (f: F): Viewer => ({ id: f.admin, role: 'admin' })

/** "Umýt okna", proposed by Táta; boys may not load it with choreBidding and openRows off. */
function proposedChore(f: F): number {
  flag(f, 'choreBidding', false)
  flag(f, 'openRows', false)
  const input = { title: 'Umýt okna', score: 6, approvalRequired: true }
  return must(createTemplate(f.db, f.tata, { ...input, schedule: null, deadline: null }, T0)).id
}

describe('task steps', () => {
  it("task.agreed with a reservation, seen by the giver and by Starší's other phone", () => {
    const f = week()
    const task = car(f)
    const row = entry(f, {
      by: f.starsi,
      action: 'task.agreed',
      entityId: String(task),
      after: { score: 8, reservedBy: f.starsi },
    })
    expect(liveText(f.db, row, giver(f))).toBe(
      'Starší · domluveno za 8 b · rezervace: Starší · Umýt auto',
    )
    expect(liveText(f.db, row, taker(f))).toBe('Ty · domluveno za 8 b · rezervace: ty · Umýt auto')
  })

  it('task.reserved by Starší, seen by Táta', () => {
    const f = week()
    const row = entry(f, { by: f.starsi, action: 'task.reserved', entityId: String(car(f)) })
    expect(liveText(f.db, row, giver(f))).toBe('Starší · rezervace · Umýt auto')
  })

  it('the scheduler: instance.expired and instance.created', () => {
    const f = week()
    const task = String(car(f))
    const expired = entry(f, { by: null, action: 'instance.expired', entityId: task })
    expect(liveText(f.db, expired, giver(f))).toBe('Podle rozvrhu · prošlo · Umýt auto')
    const created = entry(f, {
      by: null,
      action: 'instance.created',
      entityId: task,
      after: { score: 4 },
    })
    expect(liveText(f.db, created, taker(f))).toBe(
      'Podle rozvrhu · přidáno podle rozvrhu za 4 b · Umýt auto',
    )
  })

  it.each([
    ['instance.reserved', 'rezervace'],
    ['instance.released', 'uvolněno'],
    ['instance.completed', 'hotovo'],
    ['instance.approved', 'schváleno'],
    ['instance.rejected', 'vráceno'],
    ['instance.cancelled', 'zrušeno'],
  ] as const)('the unused %s reads as its task.* step: "%s"', (action, phrase) => {
    const f = week()
    const row = entry(f, { by: f.mladsi, action, entityId: String(car(f)) })
    expect(liveText(f.db, row, giver(f))).toBe(`Mladší · ${phrase} · Umýt auto`)
  })

  it('instance.created by a person, instance.self_logged', () => {
    const f = week()
    const task = String(car(f))
    const created = entry(f, { action: 'instance.created', entityId: task, after: { score: 4 } })
    expect(liveText(f.db, created, taker(f))).toBe('Táta · přidáno za 4 b · Umýt auto')
    const logged = entry(f, {
      by: f.mladsi,
      action: 'instance.self_logged',
      entityId: task,
      after: { score: 3 },
    })
    expect(liveText(f.db, logged, giver(f))).toBe('Mladší · zapsáno za 3 b · Umýt auto')
  })

  it('task.agreed reserved to a user who is gone: no reservation in the phrase', () => {
    const f = week()
    const row = entry(f, {
      action: 'task.agreed',
      entityId: String(car(f)),
      after: { score: 8, reservedBy: 9999 },
    })
    expect(liveText(f.db, row, taker(f))).toBe('Táta · domluveno za 8 b · Umýt auto')
  })

  it('a detail read failing with anything but ForbiddenError is not swallowed', () => {
    const f = week()
    const row = entry(f, { action: 'task.reserved', entityId: String(car(f)) })
    const spy = vi.spyOn(taskFns, 'taskDetailHandler').mockImplementation(() => {
      throw new Error('db down')
    })
    try {
      expect(() => liveText(f.db, row, giver(f))).toThrow('db down')
    } finally {
      spy.mockRestore()
    }
  })

  it('week_rules_dropped falls back', () => {
    const f = week()
    const task = String(car(f))
    const dropped = entry(f, { by: null, action: 'instance.week_rules_dropped', entityId: task })
    expect(liveText(f.db, dropped, giver(f))).toBe('Podle rozvrhu · změna')
  })

  it('a scored action with no after.score: fallback', () => {
    const f = week()
    const task = String(car(f))
    for (const after of [undefined, { score: 'x' }, { score: 2.5 }]) {
      const row = entry(f, { by: f.mladsi, action: 'task.bid_placed', entityId: task, after })
      expect(liveText(f.db, row, giver(f))).toBe('Mladší · změna')
    }
  })

  it('a task id that does not exist, or is not a number: fallback', () => {
    const f = week()
    for (const entityId of ['9999', 'abc', '-1', '']) {
      const row = entry(f, { action: 'task.reserved', entityId })
      expect(liveText(f.db, row, taker(f))).toBe('Táta · změna')
    }
  })

  it('the admin with disputes off on a task entry: fallback, no throw; with disputes on: title', () => {
    const f = week()
    const row = entry(f, { by: f.starsi, action: 'task.reserved', entityId: String(car(f)) })
    flag(f, 'disputes', false)
    expect(liveText(f.db, row, admin(f))).toBe('Starší · změna')
    flag(f, 'disputes', true)
    expect(liveText(f.db, row, admin(f))).toBe('Starší · rezervace · Umýt auto')
  })

  it('an actor whose user row is gone reads as the system', () => {
    const f = week()
    const row = entry(f, { by: 9999, action: 'task.reserved', entityId: String(car(f)) })
    expect(liveText(f.db, row, giver(f))).toBe('Podle rozvrhu · rezervace · Umýt auto')
  })
})

describe('chore steps', () => {
  it('template.bid_placed on an agreed chore', () => {
    const f = week()
    const chore = String(agreedTemplate(f))
    const row = entry(f, {
      by: f.mladsi,
      action: 'template.bid_placed',
      entityType: 'template',
      entityId: chore,
      after: { score: 5 },
    })
    expect(liveText(f.db, row, giver(f))).toBe('Mladší · chce 5 b · Vyndat myčku')
  })

  it('a scored chore step with no after.score: fallback', () => {
    const f = week()
    const row = entry(f, {
      by: f.mladsi,
      action: 'template.bid_placed',
      entityType: 'template',
      entityId: String(agreedTemplate(f)),
    })
    expect(liveText(f.db, row, giver(f))).toBe('Mladší · změna')
  })

  it('template.updated', () => {
    const f = week()
    const row = entry(f, {
      action: 'template.updated',
      entityType: 'template',
      entityId: String(agreedTemplate(f)),
    })
    expect(liveText(f.db, row, taker(f))).toBe('Táta · upraveno · Vyndat myčku')
  })

  const ALIASES: [AuditAction, HistoryEntry['action'], string][] = [
    ['template.created', 'task.created', 'nový úkol za 5 b'],
    ['template.score_approved', 'task.score_approved', 'souhlas s 5 b'],
    ['template.score_change_proposed', 'task.score_change_proposed', 'návrh nové ceny 5 b'],
    ['template.bid_placed', 'task.bid_placed', 'chce 5 b'],
    ['template.score_countered', 'task.score_countered', 'nabídka 5 b'],
    ['template.bid_withdrawn', 'task.bid_withdrawn', 'nabídka stažena'],
    ['template.bids_turned_down', 'task.bids_turned_down', 'nabídky odmítnuty'],
    ['template.score_changed', 'task.score_changed', 'nová cena 5 b'],
    ['template.agreed', 'task.agreed', 'domluveno za 5 b'],
    ['template.cancelled', 'task.cancelled', 'zrušeno'],
    ['template.description_changed', 'task.description_changed', 'nový popis'],
    [
      'template.description_change_proposed',
      'task.description_change_proposed',
      'návrh nového popisu',
    ],
    [
      'template.description_change_approved',
      'task.description_change_approved',
      'souhlas s novým popisem',
    ],
    [
      'template.description_change_declined',
      'task.description_change_declined',
      'nesouhlas s novým popisem',
    ],
    [
      'template.description_change_withdrawn',
      'task.description_change_withdrawn',
      'návrh popisu stažen',
    ],
  ]

  it.each(ALIASES)('%s reads as %s: "%s"', (action, as, phrase) => {
    const f = week()
    const chore = agreedTemplate(f)
    const row = entry(f, {
      action,
      entityType: 'template',
      entityId: String(chore),
      after: { score: 5 },
    })
    const same: HistoryEntry = {
      id: row.id,
      at: row.at,
      action: as,
      by: { id: f.tata, name: 'Táta' },
      score: 5,
      reservedBy: null,
      reason: null,
    }
    expect(historyText(same, f.starsi)).toBe(phrase)
    expect(liveText(f.db, row, taker(f))).toBe(`Táta · ${phrase} · Vyndat myčku`)
  })

  it('a proposed chore a taker cannot load (choreBidding, openRows off): fallback', () => {
    const f = week()
    const chore = String(proposedChore(f))
    const row = entry(f, {
      by: f.tata,
      action: 'template.score_countered',
      entityType: 'template',
      entityId: chore,
      after: { score: 4 },
    })
    expect(liveText(f.db, row, taker(f))).toBe('Táta · změna')
    expect(liveText(f.db, row, giver(f))).toBe('Ty · nabídka 4 b · Umýt okna')
    flag(f, 'choreBidding', true)
    expect(liveText(f.db, row, taker(f))).toBe('Táta · nabídka 4 b · Umýt okna')
  })

  it('one cache shared by two viewers: the giver gets the title, the taker then the fallback', () => {
    const f = week()
    const chore = String(proposedChore(f))
    const row = entry(f, {
      by: f.mladsi,
      action: 'template.bid_placed',
      entityType: 'template',
      entityId: chore,
      after: { score: 5 },
    })
    const cache: TitleCache = new Map()
    expect(liveText(f.db, row, giver(f), cache)).toBe('Mladší · chce 5 b · Umýt okna')
    expect(liveText(f.db, row, taker(f), cache)).toBe('Mladší · změna')
  })

  it('the cache: two calls for one (entity, viewer) read the detail once', () => {
    const f = week()
    const row = entry(f, { by: f.starsi, action: 'task.reserved', entityId: String(car(f)) })
    const spy = vi.spyOn(taskFns, 'taskDetailHandler')
    try {
      const cache: TitleCache = new Map()
      liveText(f.db, row, giver(f), cache)
      liveText(f.db, row, giver(f), cache)
      expect(spy).toHaveBeenCalledTimes(1)
      liveText(f.db, row, taker(f), cache)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('other actions', () => {
  const USER_SHAPES: [AuditAction, unknown, unknown, string][] = [
    ['user.created', undefined, { displayName: 'Máma', role: 'giver', active: true }, 'nový účet'],
    ['user.updated', { displayName: 'Mladší' }, { displayName: 'Nejmladší' }, 'úprava účtu'],
    ['user.updated', { role: 'taker' }, { role: 'giver' }, 'úprava účtu'],
    ['user.updated', { active: true }, { active: false }, 'úprava účtu'],
    [
      'user.updated',
      { active: true },
      { active: true, hashChanged: true, sessionsEnded: 2 },
      'úprava účtu',
    ],
  ]

  it.each(USER_SHAPES)(
    '%s (%j → %j): a taker gets only "změna", a giver the phrase',
    (action, before, after, phrase) => {
      const f = week()
      const row = entry(f, {
        by: f.admin,
        action,
        entityType: 'user',
        entityId: String(f.mladsi),
        before,
        after,
      })
      expect(liveText(f.db, row, taker(f))).toBe('Admin · změna')
      expect(liveText(f.db, row, taker(f, f.mladsi))).toBe('Admin · změna')
      expect(liveText(f.db, row, giver(f))).toBe(`Admin · ${phrase}`)
    },
  )

  const OWN: [AuditAction, EntityType, string][] = [
    ['settings.changed', 'settings', 'nové nastavení'],
    ['period.created', 'period', 'nový týden'],
    ['period.ended', 'period', 'konec týdne'],
    ['period.proposal_created', 'period_proposal', 'návrh příštího týdne'],
    ['period.proposal_approved', 'period_proposal', 'souhlas s příštím týdnem'],
    ['period.proposal_rejected', 'period_proposal', 'nesouhlas s příštím týdnem'],
    ['period.proposal_withdrawn', 'period_proposal', 'návrh příštího týdne stažen'],
    ['period.proposal_agreed', 'period_proposal', 'příští týden domluven'],
    ['period.proposal_lapsed', 'period_proposal', 'návrh příštího týdne propadl'],
    ['defaults.proposal_created', 'defaults_proposal', 'návrh výchozího týdne'],
    ['defaults.proposal_approved', 'defaults_proposal', 'souhlas s výchozím týdnem'],
    ['defaults.proposal_rejected', 'defaults_proposal', 'nesouhlas s výchozím týdnem'],
    ['defaults.proposal_withdrawn', 'defaults_proposal', 'návrh výchozího týdne stažen'],
    ['defaults.proposal_agreed', 'defaults_proposal', 'výchozí týden domluven'],
    ['settlement.created', 'settlement', 'vyúčtování týdne'],
    ['settlement.corrected', 'settlement', 'oprava vyúčtování'],
    ['points.adjusted', 'adjustment', 'oprava bodů'],
    ['dispute.opened', 'dispute', 'nový spor'],
    ['dispute.corrected', 'dispute', 'spor vyřešen opravou'],
    ['dispute.dismissed', 'dispute', 'spor uzavřen beze změny'],
    ['suggestion.created', 'suggestion', 'nový návrh na zlepšení'],
    ['suggestion.sent', 'suggestion', 'návrh poslán na GitHub'],
    ['suggestion.done', 'suggestion', 'návrh hotový'],
    ['suggestion.dismissed', 'suggestion', 'návrh zamítnutý'],
  ]

  it('the table covers every own-phrased action but user.*', () => {
    const own = AUDIT_ACTIONS.filter((a) => PHRASED[a] === 'own' && !a.startsWith('user.'))
    expect(OWN.map(([a]) => a).sort()).toEqual([...own].sort())
  })

  it.each(OWN)('%s: "Táta · %s", nothing from before / after / reason', (action, type, phrase) => {
    const f = week()
    const row = entry(f, {
      action,
      entityType: type,
      entityId: '1',
      before: { secretValue: 'BEFORE-77' },
      after: { score: 4242, note: 'AFTER-88' },
      reason: 'REASON-99',
    })
    for (const viewer of [giver(f), taker(f), admin(f)]) {
      const text = liveText(f.db, row, viewer)
      expect(text).toBe(`${viewer.id === f.tata ? 'Ty' : 'Táta'} · ${phrase}`)
      for (const leak of ['BEFORE-77', '4242', 'AFTER-88', 'REASON-99']) {
        expect(text).not.toContain(leak)
      }
    }
  })

  it("a 'none' action falls back (it never reaches a stream)", () => {
    const f = week()
    const row = entry(f, { action: 'feature.switched', entityType: 'feature', by: null })
    expect(liveText(f.db, row, giver(f))).toBe('Podle rozvrhu · změna')
  })

  it("PHRASED has a row for every AUDIT_ACTIONS entry and agrees with MAPPED on 'none'", () => {
    expect(Object.keys(PHRASED).sort()).toEqual([...AUDIT_ACTIONS].sort())
    for (const a of AUDIT_ACTIONS) {
      expect(PHRASED[a] === 'none', a).toBe(MAPPED[a] === 'none')
    }
  })
})
