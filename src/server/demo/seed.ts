import { hashSync } from '@node-rs/argon2'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import type { Db } from '~/server/db'
import { featureFlags, users } from '~/server/db/schema'
import {
  acceptOffer,
  approveTask,
  approveTaskOffer,
  cancelTask,
  completeTask,
  createTask,
  placeBid,
  proposeTaskScoreChange,
  rejectTask,
  reserveTask,
} from '~/server/tasks'
import { listPeriods, rollPeriods } from '~/server/periods'
import { getMeeting, settlePeriod } from '~/server/settlement/meeting'
import type { Tx } from '~/server/audit'
import { approveTemplateScoreIn, createTemplateIn } from '~/server/templates/templates'
import type { NewTemplate } from '~/server/templates/templates'
import { bidOnTemplateIn, counterOnTemplateIn } from '~/server/templates/scoreChange'
import { createUser } from '~/server/users'
import type { NewUser } from '~/server/users'

// Demo data for previews, dev and E2E (#62): an empty database gets the family with known
// passwords, so a preview is clickable right away. This is the only source of test users
// (Jakub 2026-11-17); production gets its one admin from ADMIN_PASSWORD (../users/bootstrap). Runs at boot (src/server/plugins) only when
// `TASKMASTER_ENV=preview`; to try it locally: `TASKMASTER_ENV=preview pnpm dev` on a fresh
// `DATA_DIR`.
//
// Guards: never without the preview flag, never when ADMIN_PASSWORD is set (a real deploy
// sets it), and never on a database that already has people (a real family's database always
// does). All tested.
//
// Grows with features: each feature PR adds its sample data here (tasks in every state, a
// template, an open period, a past settlement), in the same transaction, through the real
// actions. So far (#34): "Umýt auto" in negotiation (Táta offers 18, Starší bids 25, Mladší 22)
// and "Uklidit sklep", a plain offer of 10 with no bids. #40: done and confirmed tasks for both
// brothers' points, and an open task (see seedPoints). #44: a week of done chores, so the
// meeting has something to approve (3 items with #40's) and to settle. #45: a settled past
// week before all that (Historie), carrying 8 to Starší, and one rejection. Every launch switch
// is on, so a preview shows features that production still hides.

/** Known on purpose: previews are tailnet-only and hold no real data. Never used in production. */
export const DEMO_PASSWORD = 'demo1234'

export const DEMO_USERS: readonly NewUser[] = [
  { username: 'admin', displayName: 'Admin', role: 'admin' },
  { username: 'tata', displayName: 'Táta', role: 'giver' },
  { username: 'starsi', displayName: 'Starší', role: 'taker' },
  { username: 'mladsi', displayName: 'Mladší', role: 'taker' },
]

export type DemoOutcome =
  | { kind: 'seeded'; usernames: string[] }
  | { kind: 'skipped'; reason: 'not_preview' | 'admin_password_set' | 'not_empty' }

export function seedDemo(
  db: Db,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): DemoOutcome {
  if (env.TASKMASTER_ENV !== 'preview') return { kind: 'skipped', reason: 'not_preview' }
  // A real deploy sets ADMIN_PASSWORD. If the preview flag ever leaks into one, the known
  // demo password must still never create an account.
  if ((env.ADMIN_PASSWORD ?? '') !== '') return { kind: 'skipped', reason: 'admin_password_set' }
  if (db.select({ id: users.id }).from(users).limit(1).get()) {
    return { kind: 'skipped', reason: 'not_empty' }
  }
  const passwordHash = hashSync(DEMO_PASSWORD)
  return db.transaction((tx) => {
    // Re-checked inside the transaction, so two boots can't both seed.
    if (tx.select({ id: users.id }).from(users).limit(1).get()) {
      return { kind: 'skipped', reason: 'not_empty' } as const
    }
    const ids = new Map<string, number>()
    // The family exists from the past week's start, so the audit log reads in time order.
    const start = new Date(now.getTime() - PAST_WEEK_MS)
    for (const person of DEMO_USERS) {
      const created = createUser(tx, { kind: 'system' }, { ...person, passwordHash }, start)
      if (!created.ok)
        throw new Error(`Demo seed: cannot create "${person.username}": ${created.error}`)
      ids.set(person.username, created.value.id)
    }
    const id = (username: string) => ids.get(username) ?? 0
    const step: Step = (what, r) => {
      if (!r.ok) throw new Error(`Demo seed: ${what}: ${r.error}`)
      return r.value
    }
    // Previews show the whole app: every launch switch on (src/lib/features.ts). Production
    // never runs this seed, so its switches keep the migration's values until Jakub flips them.
    tx.update(featureFlags).set({ enabled: true }).run()
    seedPastWeek(tx, id, start, now)
    const car = step(
      'offer "Umýt auto"',
      createTask(tx, id('tata'), { title: 'Umýt auto', score: 18, approvalRequired: true }, now),
    )
    step('bid 25', placeBid(tx, id('starsi'), car.id, 25, now))
    step('bid 22', placeBid(tx, id('mladsi'), car.id, 22, now))
    step(
      'offer "Uklidit sklep"',
      createTask(
        tx,
        id('tata'),
        { title: 'Uklidit sklep', score: 10, approvalRequired: true },
        now,
      ),
    )
    // Reserved to Starší through a bidder's yes ("Beru za 8"), so his Domů row and the task page
    // show Hotovo and Uvolnit (#150). A long name, as the 360 px screens are checked with one.
    const vacuum = step(
      'offer "Vyluxovat celý obývák a chodbu"',
      createTask(
        tx,
        id('tata'),
        { title: 'Vyluxovat celý obývák a chodbu', score: 8, approvalRequired: true },
        now,
      ),
    )
    step('bid 10', placeBid(tx, id('starsi'), vacuum.id, 10, now))
    step('take 8', acceptOffer(tx, id('starsi'), vacuum.id, 8, now))
    // #36: an open task with Táta's new price waiting for the brothers, and a cancelled one
    // with its reason in the history.
    const rake = step(
      'offer "Shrabat listí na zahradě"',
      createTask(
        tx,
        id('tata'),
        { title: 'Shrabat listí na zahradě', score: 10, approvalRequired: true },
        now,
      ),
    )
    step('agree 10', approveTaskOffer(tx, id('mladsi'), rake.id, 10, now))
    step('new price 12', proposeTaskScoreChange(tx, id('tata'), rake.id, 12, now))
    const windows = step(
      'offer "Umýt okna v kuchyni"',
      createTask(
        tx,
        id('tata'),
        { title: 'Umýt okna v kuchyni', score: 6, approvalRequired: true },
        now,
      ),
    )
    step('agree 6', approveTaskOffer(tx, id('starsi'), windows.id, 6, now))
    step('cancel', cancelTask(tx, id('tata'), windows.id, 'Udělá to firma.', now))
    seedPoints(tx, id, step, now)
    seedTemplates(tx, ids, now)
    seedWeek(tx, id, now)
    return { kind: 'seeded', usernames: DEMO_USERS.map((u) => u.username) } as const
  })
}

type Step = <T>(what: string, r: { ok: true; value: T } | { ok: false; error: string }) => T

/**
 * Points for both brothers (#40), so Domů's bar shows both cases: Starší 40 confirmed + 12
 * pending (below spodní 50), Mladší 55 confirmed (past it). Plus an open task with a long name
 * for the Volné row with Rezervovat + Hotovo.
 */
function seedPoints(tx: Tx, id: (username: string) => number, step: Step, now: Date): void {
  const agreed = (title: string, score: number) => {
    const task = step(
      `offer "${title}"`,
      createTask(tx, id('tata'), { title, score, approvalRequired: true }, now),
    )
    for (const taker of ['starsi', 'mladsi']) {
      const r = step(`approve "${title}"`, approveTaskOffer(tx, id(taker), task.id, score, now))
      if (r.status !== 'proposed') break
    }
    return task.id
  }
  const done = (title: string, score: number, taker: string, confirm: boolean) => {
    const taskId = agreed(title, score)
    step(`done "${title}"`, completeTask(tx, id(taker), taskId, now))
    if (confirm) step(`approve "${title}"`, approveTask(tx, id('tata'), taskId, now))
  }
  done('Vynést tříděný odpad', 15, 'starsi', true)
  done('Uklidit pokoj', 25, 'starsi', true)
  done('Vytřít podlahu v kuchyni', 12, 'starsi', false)
  done('Umýt nádobí', 30, 'mladsi', true)
  done('Pověsit prádlo', 25, 'mladsi', true)
  agreed('Umýt okna v obýváku i v ložnici', 5)
}

/**
 * Two templates (#37): the bins wait for a boy's yes, the dishwasher is agreed, with a score
 * change in flight (#138).
 */
const DEMO_TEMPLATES: readonly NewTemplate[] = [
  {
    title: 'Vynést koše',
    score: 4,
    approvalRequired: true,
    schedule: { days: [2], time: { hour: 18, minute: 0 } },
    deadline: { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 120 },
  },
  { title: 'Vyndat myčku', score: 3, approvalRequired: true, schedule: null, deadline: null },
]

function seedTemplates(tx: Tx, ids: Map<string, number>, now: Date): void {
  const tata = ids.get('tata')
  const starsi = ids.get('starsi')
  if (tata === undefined || starsi === undefined) throw new Error('Demo seed: family incomplete')
  const made = DEMO_TEMPLATES.map((input) => {
    const created = createTemplateIn(tx, tata, input, now)
    if (!created.ok) throw new Error(`Demo seed: template "${input.title}": ${created.error}`)
    return created.value
  })
  const dishes = made[1]
  if (!dishes) return
  const agreed = approveTemplateScoreIn(tx, starsi, dishes.id, dishes.score, now)
  if (!agreed.ok) throw new Error(`Demo seed: approve "${dishes.title}": ${agreed.error}`)
  // A score change in flight (#138): Mladší bids 5, Táta offers 4.
  const mladsi = ids.get('mladsi')
  if (mladsi === undefined) throw new Error('Demo seed: family incomplete')
  const bid = bidOnTemplateIn(tx, mladsi, dishes.id, 5, now)
  if (!bid.ok) throw new Error(`Demo seed: bid on "${dishes.title}": ${bid.error}`)
  const offer = counterOnTemplateIn(tx, tata, dishes.id, 4, now)
  if (!offer.ok) throw new Error(`Demo seed: offer on "${dishes.title}": ${offer.error}`)
}

const HOUR = 3_600_000
const PAST_WEEK_MS = 7 * 24 * HOUR

/** Last week (#45), settled: Starší 108 → horní, 100 off, 8 carried; Mladší 50 → spodní, 0. */
const DEMO_PAST_WEEK: readonly { by: string; title: string; score: number }[] = [
  { by: 'starsi', title: 'Vytřít podlahu', score: 60 },
  { by: 'starsi', title: 'Uklidit garáž', score: 48 },
  { by: 'mladsi', title: 'Nakrmit kočku', score: 50 },
]

/** One chore done and approved at `at`, through the real actions. */
function doChore(tx: Tx, tata: number, boy: number, title: string, score: number, at: Date) {
  const fail = (error: string) => new Error(`Demo seed: "${title}": ${error}`)
  const made = createTask(tx, tata, { title, score, approvalRequired: true }, at)
  if (!made.ok) throw fail(made.error)
  for (const r of [
    approveTaskOffer(tx, boy, made.value.id, score, at),
    reserveTask(tx, boy, made.value.id, at),
    completeTask(tx, boy, made.value.id, at),
  ]) {
    if (!r.ok) throw fail(r.error)
  }
  return made.value.id
}

/**
 * The settled past week (#45), so Týden → Historie has a record: the first period starts at
 * `start` (a week ago), three chores are done in it, and Táta settles it an hour before its
 * cutoff or an hour ago, whichever is first. That starts this week. Then Táta rejects one of
 * Mladší's chores in this week, so Týden shows a rejection. All through the real actions.
 */
function seedPastWeek(tx: Tx, id: (username: string) => number, start: Date, now: Date): void {
  const tata = id('tata')
  rollPeriods(tx, start, DEFAULT_PERIOD_DEFAULTS)
  DEMO_PAST_WEEK.forEach((chore, i) => {
    const at = new Date(start.getTime() + (i + 1) * HOUR)
    const task = doChore(tx, tata, id(chore.by), chore.title, chore.score, at)
    const approved = approveTask(tx, tata, task, at)
    if (!approved.ok) throw new Error(`Demo seed: approve "${chore.title}": ${approved.error}`)
  })
  const week = listPeriods(tx)[0]
  if (!week) throw new Error('Demo seed: no past week')
  const settleAt = new Date(Math.min(week.cutoffAt.getTime() - HOUR, now.getTime() - HOUR))
  const meeting = getMeeting(tx, settleAt)
  if (!meeting.period) throw new Error('Demo seed: nothing to settle')
  const shown = meeting.takers.map((t) => ({ takerId: t.id, total: t.total }))
  const settled = settlePeriod(tx, tata, week.id, shown, settleAt, DEFAULT_PERIOD_DEFAULTS)
  if (!settled.ok) throw new Error(`Demo seed: settle: ${settled.error}`)
  const rejectAt = new Date(now.getTime() - HOUR / 2)
  const glass = doChore(tx, tata, id('mladsi'), 'Vynést sklo a plasty do kontejneru', 4, rejectAt)
  const rejected = rejectTask(
    tx,
    tata,
    glass,
    'Sklo zůstalo v tašce u dveří, vynes ho prosím až dolů do kontejneru.',
    rejectAt,
  )
  if (!rejected.ok) throw new Error(`Demo seed: reject "Vynést sklo": ${rejected.error}`)
}

/** Done this week (#44): approved, so they count, except the last one of each boy. */
const DEMO_WEEK: readonly { by: string; title: string; score: number; approved: boolean }[] = [
  { by: 'starsi', title: 'Uklidit koupelnu', score: 40, approved: true },
  { by: 'starsi', title: 'Posekat trávu', score: 50, approved: true },
  { by: 'starsi', title: 'Vysát auto', score: 22, approved: true },
  { by: 'mladsi', title: 'Uklidit pokoj', score: 25, approved: true },
  { by: 'mladsi', title: 'Zamést terasu', score: 12, approved: true },
  { by: 'mladsi', title: 'Vynést papír', score: 10, approved: true },
  { by: 'starsi', title: 'Zalít kytky', score: 2, approved: false },
  { by: 'mladsi', title: 'Vynést tříděný', score: 3, approved: false },
]

function seedWeek(tx: Tx, id: (username: string) => number, now: Date): void {
  const tata = id('tata')
  for (const chore of DEMO_WEEK) {
    const boy = id(chore.by)
    const fail = (what: string, error: string) =>
      new Error(`Demo seed: ${what} "${chore.title}": ${error}`)
    const made = createTask(
      tx,
      tata,
      { title: chore.title, score: chore.score, approvalRequired: true },
      now,
    )
    if (!made.ok) throw fail('offer', made.error)
    const steps = [
      () => approveTaskOffer(tx, boy, made.value.id, chore.score, now),
      () => reserveTask(tx, boy, made.value.id, now),
      () => completeTask(tx, boy, made.value.id, now),
      ...(chore.approved ? [() => approveTask(tx, tata, made.value.id, now)] : []),
    ]
    for (const step of steps) {
      const r = step()
      if (!r.ok) throw fail('step', r.error)
    }
  }
}

export function describeDemo(outcome: DemoOutcome): string | null {
  if (outcome.kind === 'skipped') {
    if (outcome.reason === 'not_empty') return '[demo] database has people already: not seeding'
    if (outcome.reason === 'admin_password_set') return '[demo] ADMIN_PASSWORD is set: not seeding'
    return null
  }
  return `[demo] seeded ${outcome.usernames.join(', ')} (password "${DEMO_PASSWORD}")`
}
