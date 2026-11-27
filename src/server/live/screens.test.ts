import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, desc, eq, gt } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { NO_FEATURES } from '~/lib/features'
import type { Features } from '~/lib/features'
import { writeAudit } from '~/server/audit'
import type { AuditEntry, AuditLogRow } from '~/server/audit'
import type { CurrentUser } from '~/server/auth'
import type { Db } from '~/server/db'
import {
  auditLog,
  featureFlags,
  pointAdjustments,
  settlements,
  tasks,
  templates,
  users,
} from '~/server/db/schema'
import type { UserRole } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { seedDemo } from '~/server/demo/seed'
import { changeDescriptionOf } from '~/server/descriptions/descriptions'
import { descriptionChangesWaitingRead } from '~/server/descriptions/functions'
import { openDisputeIn } from '~/server/disputes/disputes'
import { adminDisputesRead, disputeListRead } from '~/server/disputes/functions'
import { fixableRead } from '~/server/corrections/functions'
import { getFlags } from '~/server/features'
import { loggableTemplatesRead, weekPlanRead } from '~/server/instances/functions'
import { periodDefaultsRead } from '~/server/periods/functions'
import { proposalsRead } from '~/server/periods/proposalFunctions'
import { pointsRead } from '~/server/points/functions'
import { meetingRead, weekRead } from '~/server/settlement/functions'
import {
  bidsToAnswerRead,
  boardRead,
  pendingApprovalsRead,
  pendingCompletionsRead,
  planTasksRead,
  scoreChangesWaitingRead,
  taskDetailRead,
  tasksRead,
} from '~/server/tasks/functions'
import { addGiver, family, must } from '~/server/tasks/testing'
import {
  acceptTemplateBidHandler,
  acceptTemplateOfferHandler,
  bidTemplateScoreHandler,
  counterTemplateScoreHandler,
  pendingTemplateApprovalsRead,
  pendingTemplatePriceChangesRead,
  templateDetailHandler,
  templateDetailRead,
  templatesRead,
  turnDownTemplateBidsHandler,
  withdrawTemplateBidHandler,
} from '~/server/templates/functions'
import {
  agreementOf,
  approveTemplateScore,
  createTemplate,
  pendingTemplateApprovals,
} from '~/server/templates/templates'
import { createSuggestionAction } from '~/server/suggestions/actions'
import { adminSuggestionsRead, mySuggestionsRead } from '~/server/suggestions/functions'
import { usersRead } from '~/server/users/functions'
import { createUser, updateUser } from '~/server/users/manage'
import { topicsOf } from './mapping'
import type { LiveRead } from './read'
import { TOPIC_LIMIT } from './topics'
import type { Topic } from './topics'

// Every screen's topics (#299, design "Drift"): on the demo data each screen's union stays under
// TOPIC_LIMIT; a registry names every data function each loader calls, so a new one without a
// row fails CI; and per screen and role, the changes it must show reach it and the ones it must
// not show (a brother's facts) do not.

/** The seed's clock: a Tuesday of the running week. */
const T0 = new Date('2026-11-17T10:00:00.000Z')
/** The running week's last evening (Sunday 20:00 Prague): the meeting has a week to settle. */
const LAST_DAY = new Date('2026-11-22T19:00:00.000Z')

// ── The registry ────────────────────────────────────────────────────────────────────────

/** One data function a loader calls, type-erased: its topics for a viewer on a DB. */
interface Read {
  topics: (db: Db, viewer: CurrentUser, now: Date) => readonly Topic[]
}
type Entry = Read | 'none'

/** `def.read` then `def.topics`, as `serveLive` runs them. */
function run<A, T>(def: LiveRead<A, T>, arg?: (db: Db) => A): Read {
  return {
    topics: (db, viewer, now) => {
      const data = def.read(db, viewer, arg ? arg(db) : (undefined as A), now) as T
      return def.topics(viewer, data, db)
    },
  }
}

/** The demo's task page under test: a one-time task with a completion dispute (task 22). */
const TASK_PAGE = (db: Db) => ({ taskId: demoTask(db) })
/** The demo's chore page under test: an active chore with a score dispute (template 4). */
const CHORE_PAGE = (db: Db) => ({ templateId: demoChore(db) })

interface Screen {
  /** The route file, from the repo root. */
  route: string
  roles: UserRole[]
  /** Keyed by the `…Fn` the loader calls for this role with these switches. */
  reads: (role: UserRole, features: Features) => Record<string, Entry>
  /** When the screen is read (default T0). */
  at?: Date
}

const SCREENS: Screen[] = [
  {
    route: 'src/routes/_app/index.tsx',
    roles: ['giver', 'taker'],
    reads: (role, f) => ({
      listPendingApprovalsFn: run(pendingApprovalsRead),
      listPendingTemplateApprovalsFn: run(pendingTemplateApprovalsRead),
      listPendingTemplatePriceChangesFn: run(pendingTemplatePriceChangesRead),
      listScoreChangesWaitingFn: run(scoreChangesWaitingRead),
      ...(f.periodProposals ? { getProposalsFn: run(proposalsRead) } : {}),
      ...(role === 'taker'
        ? {
            ...(f.descriptions
              ? { listDescriptionChangesWaitingFn: run(descriptionChangesWaitingRead) }
              : {}),
            listBoardFn: run(boardRead),
            listTemplatesFn: run(templatesRead),
          }
        : {
            listPendingCompletionsFn: run(pendingCompletionsRead),
            listBidsToAnswerFn: run(bidsToAnswerRead),
            listTasksFn: run(tasksRead),
          }),
      getPointsFn: run(pointsRead),
    }),
  },
  {
    route: 'src/routes/_app/ukoly/index.tsx',
    roles: ['giver'],
    reads: () => ({ listTasksFn: run(tasksRead), listTemplatesFn: run(templatesRead) }),
  },
  {
    route: 'src/routes/_app/zapsat.tsx',
    roles: ['taker'],
    reads: () => ({ listLoggableTemplatesFn: run(loggableTemplatesRead) }),
  },
  {
    route: 'src/routes/_app/ukol/$taskId.tsx',
    roles: ['giver', 'taker', 'admin'],
    // A mark's changes fire its page topic (mapping.ts), which the page holds.
    reads: (role, f) => ({
      getTaskDetailFn: run(taskDetailRead, TASK_PAGE),
      ...(f.disputes && role !== 'admin' ? { getItemMarkFn: 'none' as const } : {}),
    }),
  },
  {
    route: 'src/routes/_app/sablona/$templateId.tsx',
    roles: ['giver', 'taker', 'admin'],
    reads: (role, f) => ({
      getTemplateDetailFn: run(templateDetailRead, CHORE_PAGE),
      ...(f.disputes && role !== 'admin' ? { getItemMarkFn: 'none' as const } : {}),
    }),
  },
  {
    route: 'src/routes/_app/tyden/index.tsx',
    roles: ['giver', 'taker'],
    reads: (_role, f) => ({
      getWeekFn: run(weekRead),
      ...(f.periodProposals ? { getProposalsFn: run(proposalsRead) } : {}),
      ...(f.disputes ? { getDisputeListFn: run(disputeListRead) } : {}),
      ...(f.weekPlan ? { getWeekPlanFn: run(weekPlanRead) } : {}),
    }),
  },
  {
    route: 'src/routes/_app/tyden/plan.tsx',
    roles: ['giver', 'taker'],
    reads: () => ({ getWeekPlanFn: run(weekPlanRead) }),
  },
  {
    route: 'src/routes/_app/tyden/pristi.tsx',
    roles: ['giver', 'taker'],
    reads: () => ({ getProposalsFn: run(proposalsRead) }),
  },
  {
    route: 'src/routes/_app/tyden/vychozi.tsx',
    roles: ['giver'],
    reads: () => ({ getProposalsFn: run(proposalsRead) }),
  },
  {
    route: 'src/routes/_app/schuzka.tsx',
    roles: ['giver'],
    reads: () => ({ getMeetingFn: run(meetingRead), listPlanTasksFn: run(planTasksRead) }),
    at: LAST_DAY,
  },
  {
    route: 'src/routes/_app/sprava.tsx',
    roles: ['admin'],
    // Passkeys and launch switches are out of scope (Jakub 2026-11-26).
    reads: () => ({
      listUsersFn: run(usersRead),
      listPasskeyCountsFn: 'none',
      getPeriodDefaultsFn: run(periodDefaultsRead),
      getAdminDisputesFn: run(adminDisputesRead),
      getFixableFn: run(fixableRead),
      getAdminSuggestionsFn: run(adminSuggestionsRead),
      getFeaturesFn: 'none',
    }),
  },
  {
    route: 'src/routes/_app/profil.tsx',
    roles: ['giver', 'taker', 'admin'],
    reads: () => ({
      getPasskeysEnabledFn: 'none',
      listMyPasskeysFn: 'none',
      listMySuggestionsFn: run(mySuggestionsRead),
    }),
  },
]

/** Routes whose loader reads nothing a screen shows. */
const NO_DATA = ['src/routes/login.tsx']

const screen = (route: string): Screen => {
  const s = SCREENS.find((x) => x.route.endsWith(route))
  if (!s) throw new Error(`no screen ${route}`)
  return s
}

// ── The demo data ───────────────────────────────────────────────────────────────────────

function demo(): Db {
  const db = createTestDb()
  const out = seedDemo(db, { TASKMASTER_ENV: 'preview', TASKMASTER_SEED: 'demo' }, T0)
  if (out.kind !== 'seeded') throw new Error('demo not seeded')
  return db
}

function person(db: Db, username: string): CurrentUser {
  const row = db.select().from(users).where(eq(users.username, username)).get()
  if (!row) throw new Error(`no ${username}`)
  return { id: row.id, username: row.username, displayName: row.displayName, role: row.role }
}

const VIEWER: Record<UserRole, string> = { giver: 'tata', taker: 'starsi', admin: 'admin' }

function demoTask(db: Db): number {
  const starsi = person(db, 'starsi').id
  const row = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.status, 'confirmed'), eq(tasks.earnerId, starsi)))
    .orderBy(desc(tasks.id))
    .get()
  if (!row) throw new Error('no confirmed task')
  return row.id
}

function demoChore(db: Db): number {
  const row = db
    .select({ id: templates.id })
    .from(templates)
    .where(eq(templates.status, 'active'))
    .get()
  if (!row) throw new Error('no active chore')
  return row.id
}

/** The screen's topics for `username`, as its loader would subscribe, with these switches. */
function topicsFor(db: Db, s: Screen, username: string, features?: Features): Set<Topic> {
  const viewer = person(db, username)
  const out = new Set<Topic>()
  for (const entry of Object.values(s.reads(viewer.role, features ?? getFlags(db)))) {
    if (entry === 'none') continue
    for (const t of entry.topics(db, viewer, s.at ?? T0)) out.add(t)
  }
  return out
}

// ── Changes ─────────────────────────────────────────────────────────────────────────────

const newestId = (db: Db) =>
  db.select({ id: auditLog.id }).from(auditLog).orderBy(desc(auditLog.id)).get()?.id ?? 0

/** The audit rows `change` wrote. */
function written(db: Db, change: () => unknown): AuditLogRow[] {
  const mark = newestId(db)
  change()
  return db.select().from(auditLog).where(gt(auditLog.id, mark)).all()
}

/** One entry through the real writer. */
function entry(db: Db, e: Omit<AuditEntry, 'actor' | 'at'>): AuditLogRow[] {
  const tata = person(db, 'tata').id
  return written(db, () => {
    db.transaction((tx) => {
      writeAudit(tx, { actor: { kind: 'user', userId: tata }, at: T0, ...e })
    })
  })
}

/** Whether any of the rows fires a topic the screen holds. */
const reaches = (db: Db, topics: Set<Topic>, rows: AuditLogRow[]) =>
  rows.some((r) => topicsOf(db, r).some((t) => topics.has(t)))

type Change = [name: string, write: (db: Db) => AuditLogRow[]]

const id = (db: Db, username: string) => person(db, username).id
const settlementOf = (db: Db, taker: string) => {
  const row = db
    .select({ id: settlements.id })
    .from(settlements)
    .where(eq(settlements.takerId, id(db, taker)))
    .get()
  if (!row) throw new Error(`no settlement for ${taker}`)
  return row.id
}
const adjustmentOf = (db: Db, taker: string) => {
  const row = db
    .select({ id: pointAdjustments.id })
    .from(pointAdjustments)
    .where(eq(pointAdjustments.takerId, id(db, taker)))
    .get()
  if (!row) throw new Error(`no adjustment for ${taker}`)
  return row.id
}
const taskWhere = (db: Db, status: (typeof tasks.$inferSelect)['status'], earner?: string) => {
  const row = db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      earner === undefined
        ? eq(tasks.status, status)
        : and(eq(tasks.status, status), eq(tasks.earnerId, id(db, earner))),
    )
    .get()
  if (!row) throw new Error(`no ${status} task`)
  return row.id
}
const proposedChore = (db: Db) => {
  const row = db
    .select({ id: templates.id })
    .from(templates)
    .where(eq(templates.status, 'proposed'))
    .get()
  if (!row) throw new Error('no proposed chore')
  return row.id
}
/** A dispute opened through the real action: its rows. */
const opened = (db: Db, by: string, item: Parameters<typeof openDisputeIn>[2]) =>
  written(db, () => must(openDisputeIn(db, id(db, by), item, 'Nesouhlasím.', T0)))

const C = {
  taskCreated: (): Change => [
    'task.created',
    (db) =>
      entry(db, { action: 'task.created', entityType: 'task', entityId: taskWhere(db, 'open') }),
  ],
  proposedChoreCreated: (): Change => [
    'proposed template.created',
    (db) =>
      entry(db, {
        action: 'template.created',
        entityType: 'template',
        entityId: proposedChore(db),
      }),
  ],
  periodProposal: (): Change => [
    'period.proposal_created',
    (db) =>
      entry(db, { action: 'period.proposal_created', entityType: 'period_proposal', entityId: 1 }),
  ],
  defaultsProposal: (): Change => [
    'defaults.proposal_created',
    (db) =>
      entry(db, {
        action: 'defaults.proposal_created',
        entityType: 'defaults_proposal',
        entityId: 1,
      }),
  ],
  adjusted: (taker: string): Change => [
    `points.adjusted for ${taker}`,
    (db) =>
      entry(db, {
        action: 'points.adjusted',
        entityType: 'adjustment',
        entityId: adjustmentOf(db, taker),
      }),
  ],
  settled: (taker: string): Change => [
    `settlement.created for ${taker}`,
    (db) =>
      entry(db, {
        action: 'settlement.created',
        entityType: 'settlement',
        entityId: settlementOf(db, taker),
      }),
  ],
  user: (action: 'user.created' | 'user.updated'): Change => [
    action,
    (db) => entry(db, { action, entityType: 'user', entityId: id(db, 'starsi') }),
  ],
  activeChore: (action: 'template.updated' | 'template.score_changed'): Change => [
    action,
    (db) => entry(db, { action, entityType: 'template', entityId: demoChore(db) }),
  ],
}

/** A suggestion made through the real action. */
const suggested = (by: string): Change => [
  `suggestion.created by ${by}`,
  (db) =>
    written(db, () =>
      must(
        createSuggestionAction(
          db,
          id(db, by),
          { title: 'Tmavý režim', description: 'Prosím.' },
          T0,
        ),
      ),
    ),
]

interface Drift {
  route: string
  username: string
  mustCatch: Change[]
  mustNotCatch?: Change[]
}

const DRIFT: Drift[] = [
  {
    route: '_app/index.tsx',
    username: 'tata',
    mustCatch: [
      C.taskCreated(),
      C.proposedChoreCreated(),
      C.periodProposal(),
      C.adjusted('starsi'),
    ],
  },
  {
    route: '_app/index.tsx',
    username: 'starsi',
    mustCatch: [
      [
        'task.approved on his task',
        (db) =>
          entry(db, {
            action: 'task.approved',
            entityType: 'task',
            entityId: taskWhere(db, 'done_unconfirmed', 'starsi'),
          }),
      ],
      C.proposedChoreCreated(),
      [
        'template.score_approved on a proposed chore',
        (db) =>
          entry(db, {
            action: 'template.score_approved',
            entityType: 'template',
            entityId: proposedChore(db),
          }),
      ],
    ],
    mustNotCatch: [C.adjusted('mladsi'), C.settled('mladsi')],
  },
  {
    route: '_app/ukoly/index.tsx',
    username: 'tata',
    mustCatch: [
      [
        'task.cancelled',
        (db) =>
          entry(db, {
            action: 'task.cancelled',
            entityType: 'task',
            entityId: taskWhere(db, 'open'),
          }),
      ],
      C.activeChore('template.updated'),
    ],
  },
  {
    route: '_app/zapsat.tsx',
    username: 'starsi',
    mustCatch: [
      [
        'instance.self_logged',
        (db) =>
          entry(db, {
            action: 'instance.self_logged',
            entityType: 'task',
            entityId: taskWhere(db, 'done_unconfirmed', 'mladsi'),
          }),
      ],
      C.activeChore('template.updated'),
    ],
  },
  ...(['tata', 'starsi', 'admin'] as const).map((username): Drift => ({
    route: '_app/ukol/$taskId.tsx',
    username,
    mustCatch: [
      [
        'task.bid_placed',
        (db) =>
          entry(db, { action: 'task.bid_placed', entityType: 'task', entityId: demoTask(db) }),
      ],
      [
        'dispute.opened on its score',
        (db) => opened(db, 'starsi', { kind: 'task_score', id: demoTask(db) }),
      ],
    ],
  })),
  ...(['tata', 'starsi', 'admin'] as const).map((username): Drift => ({
    route: '_app/sablona/$templateId.tsx',
    username,
    mustCatch: [C.activeChore('template.score_changed')],
  })),
  {
    route: '_app/tyden/index.tsx',
    username: 'tata',
    mustCatch: [
      C.settled('starsi'),
      C.settled('mladsi'),
      [
        "dispute.opened on a boy's item",
        (db) => opened(db, 'mladsi', { kind: 'adjustment', id: adjustmentOf(db, 'mladsi') }),
      ],
      C.user('user.updated'),
    ],
  },
  {
    route: '_app/tyden/index.tsx',
    username: 'starsi',
    mustCatch: [
      C.settled('starsi'),
      [
        'dispute.opened by him',
        (db) => opened(db, 'starsi', { kind: 'adjustment', id: adjustmentOf(db, 'mladsi') }),
      ],
    ],
    mustNotCatch: [
      C.settled('mladsi'),
      C.adjusted('mladsi'),
      [
        "a dispute.opened on mladsi's adjustment",
        (db) => opened(db, 'mladsi', { kind: 'adjustment', id: adjustmentOf(db, 'mladsi') }),
      ],
    ],
  },
  ...(['tata', 'starsi'] as const).map((username): Drift => ({
    route: '_app/tyden/pristi.tsx',
    username,
    mustCatch: [C.periodProposal(), C.defaultsProposal()],
  })),
  {
    route: '_app/tyden/vychozi.tsx',
    username: 'tata',
    mustCatch: [C.periodProposal(), C.defaultsProposal()],
  },
  {
    route: '_app/schuzka.tsx',
    username: 'tata',
    mustCatch: [
      [
        'task.completed',
        (db) =>
          entry(db, {
            action: 'task.completed',
            entityType: 'task',
            entityId: taskWhere(db, 'open'),
          }),
      ],
      C.settled('starsi'),
      C.user('user.created'),
    ],
  },
  {
    route: '_app/sprava.tsx',
    username: 'admin',
    mustCatch: [
      C.user('user.created'),
      [
        'settings.changed',
        (db) => entry(db, { action: 'settings.changed', entityType: 'settings', entityId: 1 }),
      ],
      [
        'dispute.opened',
        (db) => opened(db, 'mladsi', { kind: 'adjustment', id: adjustmentOf(db, 'mladsi') }),
      ],
      C.adjusted('starsi'),
      suggested('starsi'),
    ],
  },
  ...(['tata', 'starsi'] as const).map((username): Drift => ({
    route: '_app/tyden/plan.tsx',
    username,
    mustCatch: [
      [
        'instance.reserved on a week copy',
        (db) =>
          entry(db, {
            action: 'instance.reserved',
            entityType: 'task',
            entityId: taskWhere(db, 'open'),
          }),
      ],
      C.activeChore('template.updated'),
    ],
  })),
  ...(['tata', 'starsi', 'admin'] as const).map((username): Drift => ({
    route: '_app/profil.tsx',
    username,
    mustCatch: [suggested(username)],
    // Another person's suggestion is not on his Profil.
    mustNotCatch: [suggested(username === 'starsi' ? 'mladsi' : 'starsi')],
  })),
]

// ── Tests ───────────────────────────────────────────────────────────────────────────────

const ROUTES_DIR = 'src/routes'

/** Every route file whose source has a loader. */
function routesWithLoader(): string[] {
  return readdirSync(ROUTES_DIR, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(ROUTES_DIR, f))
    .filter((f) => readFileSync(f, 'utf8').includes('loader:'))
    .sort()
}

/** The `…Fn` calls inside a route's `loader:` block (up to the next route option). */
function loaderCalls(route: string): Set<string> {
  const source = readFileSync(route, 'utf8')
  const start = source.indexOf('loader:')
  const end = source.slice(start).search(/\n {2}[a-zA-Z]+:/)
  const block = source.slice(start, end === -1 ? undefined : start + end)
  return new Set([...block.matchAll(/\b(\w+Fn)\(/g)].map((m) => m[1] ?? ''))
}

/** The switch values a loader may branch on: the demo's (all on) and all off. */
const SWITCHES = (db: Db): Features[] => [getFlags(db), { ...NO_FEATURES }]

describe('the registry', () => {
  it('every route with a loader is a screen or on NO_DATA', () => {
    const known = new Set([...SCREENS.map((s) => s.route), ...NO_DATA])
    const routes = routesWithLoader()
    expect(routes.length).toBeGreaterThan(SCREENS.length)
    for (const r of routes) expect(known.has(r), r).toBe(true)
  })

  it('every …Fn a loader calls has a registry row', () => {
    const db = demo()
    for (const s of SCREENS) {
      const want = new Set<string>()
      for (const role of s.roles) {
        for (const f of SWITCHES(db)) for (const k of Object.keys(s.reads(role, f))) want.add(k)
      }
      expect(loaderCalls(s.route), s.route).toEqual(want)
    }
  })
})

describe('the limit', () => {
  const db = demo()
  const domuOff = { ...getFlags(db), periodProposals: false, descriptions: false }
  for (const s of SCREENS) {
    for (const role of s.roles) {
      it(`${s.route} as ${role}: at most TOPIC_LIMIT topics`, () => {
        const n = topicsFor(db, s, VIEWER[role]).size
        expect(n).toBeLessThanOrEqual(TOPIC_LIMIT)
        if (s.route.endsWith('_app/index.tsx')) {
          expect(topicsFor(db, s, VIEWER[role], domuOff).size).toBeLessThanOrEqual(n)
        }
      })
    }
  }

  it('Profil: only his own suggestions; with suggestions off no topics, so no stream', () => {
    for (const role of ['giver', 'taker', 'admin'] as const) {
      const viewer = person(db, VIEWER[role])
      expect([...topicsFor(db, screen('_app/profil.tsx'), VIEWER[role])]).toEqual([
        `suggestions:by:${String(viewer.id)}`,
      ])
    }
    const offDb = demo()
    offDb
      .update(featureFlags)
      .set({ enabled: false })
      .where(eq(featureFlags.key, 'suggestions'))
      .run()
    for (const role of ['giver', 'taker', 'admin'] as const) {
      expect(topicsFor(offDb, screen('_app/profil.tsx'), VIEWER[role]).size).toBe(0)
    }
  })
})

describe('drift', () => {
  for (const d of DRIFT) {
    for (const [name, write] of d.mustCatch) {
      it(`${d.route} as ${d.username} catches ${name}`, () => {
        const db = demo()
        const topics = topicsFor(db, screen(d.route), d.username)
        const rows = write(db)
        expect(rows.length).toBeGreaterThan(0)
        expect(reaches(db, topics, rows)).toBe(true)
      })
    }
    for (const [name, write] of d.mustNotCatch ?? []) {
      it(`${d.route} as ${d.username} does not catch ${name}`, () => {
        const db = demo()
        const topics = topicsFor(db, screen(d.route), d.username)
        const rows = write(db)
        expect(rows.length).toBeGreaterThan(0)
        expect(reaches(db, topics, rows)).toBe(false)
      })
    }
  }

  it("Domů as starsi, with the switches off: still a brother's facts never reach him", () => {
    const db = demo()
    const off = { ...getFlags(db), periodProposals: false, descriptions: false }
    const topics = topicsFor(db, screen('_app/index.tsx'), 'starsi', off)
    for (const [, write] of [C.adjusted('mladsi'), C.settled('mladsi')]) {
      expect(reaches(db, topics, write(db))).toBe(false)
    }
  })
})

/**
 * A proposed chore that left the boys' lists (demo data, real calls): Táta created it, Máma was
 * added, the admin deactivated Táta (no active giver yes, so it stays proposed) and Mladší said
 * yes. It now waits for a giver only. Starší's Domů is read before each change.
 */
describe("a proposed chore that left the boys' lists", () => {
  function setup() {
    const db = demo()
    const admin = { kind: 'user', userId: id(db, 'admin') } as const
    const input = {
      title: 'Umýt okna',
      score: 6,
      approvalRequired: true,
      schedule: null,
      deadline: null,
    }
    const chore = must(createTemplate(db, id(db, 'tata'), input, T0)).id
    const mama = must(
      createUser(db, admin, { username: 'mama', displayName: 'Máma', role: 'giver' }, T0),
    ).id
    must(updateUser(db, admin, id(db, 'tata'), { active: false }, T0))
    must(approveTemplateScore(db, id(db, 'mladsi'), chore, 6, T0))
    const listed = (who: string) =>
      pendingTemplateApprovals(db, id(db, who)).some((t) => t.id === chore)
    expect(db.select().from(templates).where(eq(templates.id, chore)).get()?.status).toBe(
      'proposed',
    )
    expect(listed('starsi')).toBe(false)
    expect(listed('mladsi')).toBe(false)
    const before = topicsFor(db, screen('_app/index.tsx'), 'starsi')
    return { db, admin, chore, mama, listed, before }
  }

  it('(a) a giver changes its description: back on his list, and his Domů catches it', () => {
    const { db, chore, mama, listed, before } = setup()
    const rows = written(db, () =>
      must(changeDescriptionOf(db, { kind: 'template', id: chore }, mama, 'Všechna okna.', T0)),
    )
    expect(rows.map((r) => r.action)).toContain('template.description_changed')
    expect(listed('starsi')).toBe(true)
    expect(reaches(db, before, rows)).toBe(true)
  })

  it('(b) the admin deactivates Mladší: his yes no longer counts; only user.updated, still caught', () => {
    const { db, admin, listed, before } = setup()
    const rows = written(db, () =>
      must(updateUser(db, admin, id(db, 'mladsi'), { active: false }, T0)),
    )
    expect(rows.map((r) => r.action)).toEqual(['user.updated'])
    expect(listed('starsi')).toBe(true)
    expect(reaches(db, before, rows)).toBe(true)
  })
})

/**
 * Why a taker may hold `templates:proposed` (README "Subscribing"): once a proposed chore has
 * left the boys' lists, every action that still writes an entry on it ends with the chore
 * listed for each active boy again, agreed, loadable by him, or already said yes to by him (he
 * saw it on his list when he did). Refused actions write nothing, so no event.
 */
describe("every action on a proposed chore that left the boys' lists", () => {
  type F = ReturnType<typeof setupChore>
  function setupChore(choreBidding: boolean) {
    const f = family()
    for (const [key, enabled] of [
      ['choreBidding', choreBidding],
      ['openRows', false],
      ['descriptions', true],
    ] as const) {
      f.db.update(featureFlags).set({ enabled }).where(eq(featureFlags.key, key)).run()
    }
    const mama = addGiver(f)
    const input = {
      title: 'Umýt okna',
      score: 6,
      approvalRequired: true,
      schedule: null,
      deadline: null,
    }
    const chore = must(createTemplate(f.db, f.tata, input, T0)).id
    must(updateUser(f.db, { kind: 'user', userId: f.admin }, f.tata, { active: false }))
    must(approveTemplateScore(f.db, f.mladsi, chore, 6))
    return { ...f, mama, chore }
  }

  const now = () => T0
  /** A boy's page showed no description (the descriptions switch is on). */
  const SAW = { seenDescription: null }
  const ACTIONS: [name: string, choreBidding: boolean, act: (f: F) => unknown][] = [
    ['a giver says yes', false, (f) => approveTemplateScore(f.db, f.mama, f.chore, 6)],
    [
      'a giver changes its description',
      false,
      (f) => changeDescriptionOf(f.db, { kind: 'template', id: f.chore }, f.mama, 'Nový popis.'),
    ],
    [
      'the other boy says yes (a stale screen)',
      false,
      (f) => approveTemplateScore(f.db, f.starsi, f.chore, 6),
    ],
    [
      'the boy who said yes says it again',
      false,
      (f) => approveTemplateScore(f.db, f.mladsi, f.chore, 6),
    ],
    ...[false, true].flatMap((on): [string, boolean, (f: F) => unknown][] => [
      [
        `a boy bids (choreBidding ${String(on)})`,
        on,
        (f) =>
          bidTemplateScoreHandler(f.db, f.starsi, { templateId: f.chore, score: 5, ...SAW }, now()),
      ],
      [
        `a giver counters (choreBidding ${String(on)})`,
        on,
        (f) => counterTemplateScoreHandler(f.db, f.mama, { templateId: f.chore, score: 4 }, now()),
      ],
      [
        `a boy accepts the offer (choreBidding ${String(on)})`,
        on,
        (f) =>
          acceptTemplateOfferHandler(
            f.db,
            f.starsi,
            { templateId: f.chore, score: 6, ...SAW },
            now(),
          ),
      ],
      [
        `a giver turns a bid down (choreBidding ${String(on)})`,
        on,
        (f) => {
          bidTemplateScoreHandler(f.db, f.starsi, { templateId: f.chore, score: 5, ...SAW }, now())
          return turnDownTemplateBidsHandler(
            f.db,
            f.mama,
            { templateId: f.chore, bids: [{ takerId: f.starsi, score: 5 }] },
            now(),
          )
        },
      ],
      [
        `a giver accepts the lowest bid (choreBidding ${String(on)})`,
        on,
        (f) => {
          bidTemplateScoreHandler(f.db, f.starsi, { templateId: f.chore, score: 5, ...SAW }, now())
          return acceptTemplateBidHandler(f.db, f.mama, { templateId: f.chore, score: 5 }, now())
        },
      ],
      [
        `a boy withdraws his bid (choreBidding ${String(on)})`,
        on,
        (f) => {
          bidTemplateScoreHandler(f.db, f.starsi, { templateId: f.chore, score: 5, ...SAW }, now())
          return withdrawTemplateBidHandler(f.db, f.starsi, { templateId: f.chore }, now())
        },
      ],
    ]),
  ]

  /** The entries `act` writes on the chore, on a fresh chore. */
  const onChore = (f: F, act: (f: F) => unknown) =>
    written(f.db, () => act(f)).filter(
      (r) => r.entityType === 'template' && r.entityId === String(f.chore),
    )

  for (const [name, choreBidding, act] of ACTIONS) {
    it(name, () => {
      const f = setupChore(choreBidding)
      if (onChore(f, act).length === 0) return
      const row = f.db.select().from(templates).where(eq(templates.id, f.chore)).get()
      if (!row) throw new Error('gone')
      if (row.status === 'active') return
      const agreement = agreementOf(f.db, row)
      const saidYes = agreement.status === 'proposed' ? agreement.proposal.approvedBy : []
      for (const boy of [f.starsi, f.mladsi]) {
        const listed = pendingTemplateApprovals(f.db, boy).some((t) => t.id === f.chore)
        const loadable =
          templateDetailHandler(f.db, { id: boy, role: 'taker' }, { templateId: f.chore }) !== null
        expect(listed || loadable || saidYes.includes(boy), `${name}: boy ${String(boy)}`).toBe(
          true,
        )
      }
    })
  }

  it('most actions write an entry on the chore', () => {
    const count = ACTIONS.filter(
      ([, choreBidding, act]) => onChore(setupChore(choreBidding), act).length > 0,
    ).length
    expect(count).toBeGreaterThanOrEqual(4)
  })
})
