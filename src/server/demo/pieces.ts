import { and, eq } from 'drizzle-orm'
import type { Tx } from '~/server/audit'
import { nextPeriod } from '~/domain'
import { addPragueDays, startOfPragueDay, toIsoUtc, toPragueWallTime } from '~/domain/dates'
import { settlements, tasks as taskTable, templates as templateTable } from '~/server/db/schema'
import { adjustPointsIn, correctSettlementIn } from '~/server/corrections'
import { changeDescriptionOf } from '~/server/descriptions/descriptions'
import { dismissDisputeIn, loadTarget, openDisputeIn } from '~/server/disputes'
import {
  createOnDemandInstance,
  createScheduledInstances,
  expireOverdueInstances,
  makeWeekCopies,
  selfLogInstance,
} from '~/server/instances'
import {
  approveProposal,
  currentPeriod,
  getPeriodDefaults,
  listPeriods,
  proposeDefaultsChange,
  proposePeriod,
  rollPeriods,
  writePeriodDefaults,
} from '~/server/periods'
import { getMeeting, settlePeriod } from '~/server/settlement/meeting'
import { closeSuggestionIn, createSuggestionIn } from '~/server/suggestions/store'
import {
  acceptOffer,
  approveTask,
  approveTaskOffer,
  cancelTask,
  completeTask,
  createTask,
  expireTask,
  placeBid,
  proposeTaskScoreChange,
  rejectTask,
  reopenBidding,
  reserveTask,
} from '~/server/tasks'
import { approveTemplateScoreIn, createTemplateIn } from '~/server/templates/templates'
import type { NewTemplate } from '~/server/templates/templates'
import {
  acceptLowestBidOnTemplateIn,
  bidOnTemplateIn,
  counterOnTemplateIn,
} from '~/server/templates/scoreChange'

// The demo seed's pieces (#183): one per feature's sample data, each through the real actions
// in the seed's one transaction. A seed (./seeds.ts) is a list of them; previews get `demo`,
// which has them all, and each e2e suite gets only the ones it needs, so a new feature's data
// never changes another suite's numbers.

export interface SeedContext {
  tx: Tx
  /** The family member's id by username (admin, tata, starsi, mladsi). */
  id: (username: string) => number
  now: Date
  /** A week before `now`: when the family is created and the past week starts. */
  start: Date
}

export type Piece = (ctx: SeedContext) => void

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** The value of a real action, or the seed fails (and rolls back) naming the step. */
function step<T>(what: string, r: Result<T>): T {
  if (!r.ok) throw new Error(`Demo seed: ${what}: ${r.error}`)
  return r.value
}

const offer = (ctx: SeedContext, title: string, score: number) =>
  step(
    `offer "${title}"`,
    createTask(ctx.tx, ctx.id('tata'), { title, score, approvalRequired: true }, ctx.now),
  )

/**
 * #34 and #150: "Umýt auto" in negotiation (Táta offers 18, Anička bids 25, Béďa 22),
 * "Uklidit sklep", a plain offer of 10 with no bids, and a task reserved to Anička through a
 * bidder's yes ("Beru za 8"), so her Domů row and the task page show Hotovo and Uvolnit. A long
 * name, as the 360 px screens are checked with one.
 */
export const negotiation: Piece = (ctx) => {
  const { tx, id, now } = ctx
  const car = offer(ctx, 'Umýt auto', 18)
  step('bid 25', placeBid(tx, id('starsi'), car.id, 25, now))
  step('bid 22', placeBid(tx, id('mladsi'), car.id, 22, now))
  offer(ctx, 'Uklidit sklep', 10)
  const vacuum = offer(ctx, 'Vyluxovat celý obývák a chodbu', 8)
  step('bid 10', placeBid(tx, id('starsi'), vacuum.id, 10, now))
  step('take 8', acceptOffer(tx, id('starsi'), vacuum.id, 8, now))
}

/**
 * #212: "Vynést staré věci na půdu", agreed at 12 by Béďa's yes after Anička bid 14 (that row
 * is an earlier round, hidden on screen), now in a round Anička reopened, with Béďa's bid 15.
 * "Zamést chodník před domem", free at 6, never reopened: the reopen button.
 */
export const rebidding: Piece = (ctx) => {
  const { tx, id, now } = ctx
  const attic = offer(ctx, 'Vynést staré věci na půdu', 12)
  step('bid 14', placeBid(tx, id('starsi'), attic.id, 14, now))
  step('agree 12', approveTaskOffer(tx, id('mladsi'), attic.id, 12, now))
  step('reopen', reopenBidding(tx, id('starsi'), attic.id, now))
  step('bid 15', placeBid(tx, id('mladsi'), attic.id, 15, now))
  const terrace = offer(ctx, 'Zamést chodník před domem', 6)
  step('agree 6', approveTaskOffer(tx, id('starsi'), terrace.id, 6, now))
}

/** #36: an open task at 10 with Táta's new price 12 waiting for the brothers. */
export const priceChange: Piece = (ctx) => {
  const { tx, id, now } = ctx
  const rake = offer(ctx, 'Shrabat listí na zahradě', 10)
  step('agree 10', approveTaskOffer(tx, id('mladsi'), rake.id, 10, now))
  step('new price 12', proposeTaskScoreChange(tx, id('tata'), rake.id, 12, now))
}

/**
 * #207: what done means. "Uklidit kolárnu" proposed with a two-line text, so a brother reads it
 * before he agrees; "Odnést krabice do sklepa" open, with Táta's new text waiting for a brother's
 * OK; the chore "Utřít prach v pokoji" agreed with a text.
 */
export const descriptions: Piece = (ctx) => {
  const { tx, id, now } = ctx
  const give = (title: string, score: number, description: string) =>
    step(
      `offer "${title}"`,
      createTask(tx, id('tata'), { title, score, approvalRequired: true, description }, now),
    )
  give('Uklidit kolárnu', 14, 'Zamést celou podlahu.\nKola pověsit na háky.')
  const boxes = give('Odnést krabice do sklepa', 8, 'Všechny krabice z chodby.')
  step('agree 8', approveTaskOffer(tx, id('mladsi'), boxes.id, 8, now))
  step(
    'new text',
    changeDescriptionOf(
      tx,
      { kind: 'task', id: boxes.id },
      id('tata'),
      'Všechny krabice z chodby.\nPrázdné složit a dát k popelnicím.',
      now,
    ),
  )
  const input: NewTemplate = {
    title: 'Utřít prach v pokoji',
    score: 4,
    approvalRequired: true,
    schedule: null,
    deadline: null,
    description: 'Police, stůl i parapet. Hadr je pod dřezem.',
  }
  const dust = step('template "Utřít prach"', createTemplateIn(tx, id('tata'), input, now))
  step('approve "Utřít prach"', approveTemplateScoreIn(tx, id('starsi'), dust.id, 4, now))
}

/** #36: a cancelled task with its reason in the history. */
export const cancelled: Piece = (ctx) => {
  const { tx, id, now } = ctx
  const windows = offer(ctx, 'Umýt okna v kuchyni', 6)
  step('agree 6', approveTaskOffer(tx, id('starsi'), windows.id, 6, now))
  step('cancel', cancelTask(tx, id('tata'), windows.id, 'Udělá to firma.', now))
}

/**
 * Points for both brothers (#40), so Domů's bar shows both cases. On its own this piece gives
 * Anička 40 confirmed + 12 pending (below spodní 50) and Béďa 55 confirmed (past it). Plus an
 * open task with a long name for the Volné row with Rezervovat + Hotovo.
 */
export const points: Piece = (ctx) => {
  const { tx, id, now } = ctx
  const agreed = (title: string, score: number) => {
    const task = offer(ctx, title, score)
    for (const taker of ['starsi', 'mladsi']) {
      const r = step(`approve "${title}"`, approveTaskOffer(tx, id(taker), task.id, score, now))
      if (r.status !== 'proposed') break
    }
    return task.id
  }
  const done = (title: string, score: number, taker: string, confirm: boolean) => {
    const taskId = agreed(title, score)
    step(`done "${title}"`, completeTask(tx, id(taker), taskId, now, false))
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
 * Three templates (#37): the bins wait for a boy's yes, the dishwasher is agreed, with a score
 * change in flight (#138): Béďa bids 5, Táta offers 4; the school bag is agreed with a
 * deadline (#38).
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
  {
    title: 'Nachystat tašku do školy',
    score: 2,
    approvalRequired: true,
    schedule: null,
    deadline: { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 30 },
  },
]

export const templates: Piece = ({ tx, id, now }) => {
  const made = DEMO_TEMPLATES.map((input) =>
    step(`template "${input.title}"`, createTemplateIn(tx, id('tata'), input, now)),
  )
  const [, dishes, bag] = made
  if (!dishes || !bag) return
  for (const t of [dishes, bag]) {
    step(`approve "${t.title}"`, approveTemplateScoreIn(tx, id('starsi'), t.id, t.score, now))
  }
  const what = (verb: string) => `${verb} "${dishes.title}"`
  step(what('bid on'), bidOnTemplateIn(tx, id('mladsi'), dishes.id, 5, now))
  step(what('offer on'), counterOnTemplateIn(tx, id('tata'), dishes.id, 4, now))
}

/**
 * #209: two chores Táta proposed, open for bids with `choreBidding` on. "Vynést kompost" at 10 with
 * no bids, "Zalít kytky" at 4 with Anička's bid 6 and Béďa's bid 7.
 */
export const choreBidding: Piece = ({ tx, id, now }) => {
  const on = { choreBidding: true, bidRefusals: false }
  const make = (title: string, score: number) =>
    step(
      `template "${title}"`,
      createTemplateIn(
        tx,
        id('tata'),
        { title, score, approvalRequired: true, schedule: null, deadline: null },
        now,
      ),
    )
  make('Vynést kompost', 10)
  const plants = make('Zalít kytky', 4)
  for (const [who, score] of [
    ['starsi', 6],
    ['mladsi', 7],
  ] as const) {
    step(`bid on "${plants.title}"`, bidOnTemplateIn(tx, id(who), plants.id, score, now, on))
  }
}

/**
 * #232: "Umýt koupelnu", agreed at 8, with a price change of two bids and no parents' offer:
 * Anička 10, Béďa 11. Nechci and the turn-down on it need `bidRefusals`.
 */
export const choreChange: Piece = ({ tx, id, now }) => {
  const input = { title: 'Umýt koupelnu', score: 8, approvalRequired: true }
  const bath = step(
    `template "${input.title}"`,
    createTemplateIn(tx, id('tata'), { ...input, schedule: null, deadline: null }, now),
  )
  step(`approve "${bath.title}"`, approveTemplateScoreIn(tx, id('starsi'), bath.id, 8, now))
  for (const [who, score] of [
    ['starsi', 10],
    ['mladsi', 11],
  ] as const) {
    step(`bid on "${bath.title}"`, bidOnTemplateIn(tx, id(who), bath.id, score, now))
  }
}

const HOUR = 3_600_000

/** One chore done (not yet approved) at `at`, through the real actions. */
function doChore(ctx: SeedContext, by: string, title: string, score: number, at: Date) {
  const { tx, id } = ctx
  const what = `"${title}"`
  const made = step(
    `offer ${what}`,
    createTask(tx, id('tata'), { title, score, approvalRequired: true }, at),
  )
  step(`agree ${what}`, approveTaskOffer(tx, id(by), made.id, score, at))
  step(`reserve ${what}`, reserveTask(tx, id(by), made.id, at, false))
  step(`done ${what}`, completeTask(tx, id(by), made.id, at, false))
  return made.id
}

/** Last week (#45), settled: Anička 108 → horní, 100 off, 8 carried; Béďa 50 → spodní, 0. */
const PAST_WEEK: readonly { by: string; title: string; score: number }[] = [
  { by: 'starsi', title: 'Vytřít podlahu', score: 60 },
  { by: 'starsi', title: 'Uklidit garáž', score: 48 },
  { by: 'mladsi', title: 'Nakrmit kočku', score: 50 },
]

/**
 * The settled past week (#45), so Týden → Historie has a record: the first period starts at
 * `start` (a week ago), three chores are done in it, and Táta settles it an hour before its
 * cutoff or an hour ago, whichever is first. That starts this week. Then Táta rejects one of
 * Béďa's chores in this week, so Týden shows a rejection. Must come first in a seed: it
 * writes at `start`, and the audit log reads in time order.
 */
export const pastWeek: Piece = (ctx) => {
  pastWeekWith(ctx, [])
}

/**
 * The past week with the everyday schedule (#39) running in it: `schedule` goes between the
 * chores and the settlement, so the audit log stays in time order. Previews get this one.
 */
export const pastWeekScheduled: Piece = (ctx) => {
  pastWeekWith(ctx, [schedule])
}

interface PastWeekOpts {
  chores?: typeof PAST_WEEK
  /** When Táta settles: default an hour before the cutoff or an hour ago, whichever is first. */
  settleAt?: Date
  /** Runs right after the settlement, before the rejection. */
  after?: readonly Piece[]
}

/** `during` runs after the past week's chores and before Táta settles it. */
function pastWeekWith(ctx: SeedContext, during: readonly Piece[], opts: PastWeekOpts = {}): void {
  const { tx, id, start, now } = ctx
  const tata = id('tata')
  rollPeriods(tx, start, getPeriodDefaults(tx))
  ;(opts.chores ?? PAST_WEEK).forEach((chore, i) => {
    const at = new Date(start.getTime() + (i + 1) * HOUR)
    const task = doChore(ctx, chore.by, chore.title, chore.score, at)
    step(`approve "${chore.title}"`, approveTask(tx, tata, task, at))
  })
  for (const piece of during) piece(ctx)
  const week = listPeriods(tx)[0]
  if (!week) throw new Error('Demo seed: no past week')
  const settleAt =
    opts.settleAt ?? new Date(Math.min(week.cutoffAt.getTime() - HOUR, now.getTime() - HOUR))
  // Off: this builds history mid-week (the past week settled early, as before #211). The seed's
  // switches are set after its pieces, and 0027 writes `settleLastDay` on.
  const meeting = getMeeting(tx, settleAt, false)
  if (!meeting.period) throw new Error('Demo seed: nothing to settle')
  const shown = meeting.takers.map((t) => ({ takerId: t.id, total: t.total }))
  step('settle', settlePeriod(tx, tata, week.id, shown, settleAt, false))
  for (const piece of opts.after ?? []) piece(ctx)
  const rejectAt = new Date(now.getTime() - HOUR / 2)
  const glass = doChore(ctx, 'mladsi', 'Vynést sklo a plasty do kontejneru', 4, rejectAt)
  step(
    'reject "Vynést sklo"',
    rejectTask(
      tx,
      tata,
      glass,
      'Sklo zůstalo v tašce u dveří, vynes ho prosím až dolů do kontejneru.',
      rejectAt,
    ),
  )
}

/** Done this week (#44): approved, so they count, except the last one of each boy. */
const THIS_WEEK: readonly { by: string; title: string; score: number; approved: boolean }[] = [
  { by: 'starsi', title: 'Uklidit koupelnu', score: 40, approved: true },
  { by: 'starsi', title: 'Posekat trávu', score: 50, approved: true },
  { by: 'starsi', title: 'Vysát auto', score: 22, approved: true },
  { by: 'mladsi', title: 'Uklidit pokoj po návštěvě', score: 25, approved: true },
  { by: 'mladsi', title: 'Zamést terasu', score: 12, approved: true },
  { by: 'mladsi', title: 'Vynést papír', score: 10, approved: true },
  { by: 'starsi', title: 'Zalít kytky', score: 2, approved: false },
  { by: 'mladsi', title: 'Vynést tříděný', score: 3, approved: false },
]

/** This week's chores (#44), so the meeting has something to approve and to settle. */
export const thisWeek: Piece = (ctx) => {
  thisWeekWith(ctx, THIS_WEEK)
}

function thisWeekWith(ctx: SeedContext, chores: typeof THIS_WEEK): void {
  for (const chore of chores) {
    const task = doChore(ctx, chore.by, chore.title, chore.score, ctx.now)
    if (chore.approved) {
      step(`approve "${chore.title}"`, approveTask(ctx.tx, ctx.id('tata'), task, ctx.now))
    }
  }
}

const DISMISS_NOTE = 'Body sedí, zkontroloval jsem to s tátou.'

/**
 * Disputes (#46, #47), after `thisWeek` and a past week: Anička disputes her confirmed "Vysát
 * auto" (open, so Týden shows Sporné and Správa lists it); Béďa disputes his past-week
 * settlement and the admin keeps it as it was, with a note (the admin's own dismiss).
 */
export const disputes: Piece = ({ tx, id, now }) => {
  const car = tx
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(and(eq(taskTable.title, 'Vysát auto'), eq(taskTable.status, 'confirmed')))
    .get()
  if (!car) throw new Error('Demo seed: no confirmed "Vysát auto"')
  step(
    'dispute "Vysát auto"',
    openDisputeIn(
      tx,
      id('starsi'),
      { kind: 'completion', id: car.id },
      'Vysávala jsem i kufr, to je víc práce.',
      now,
    ),
  )
  const record = tx
    .select({ id: settlements.id })
    .from(settlements)
    .where(eq(settlements.takerId, id('mladsi')))
    .get()
  if (!record) throw new Error('Demo seed: no settlement for Béďa')
  const opened = step(
    'dispute the settlement',
    openDisputeIn(
      tx,
      id('mladsi'),
      { kind: 'settlement', id: record.id },
      'Kočku jsem krmil i v neděli, to tam chybí.',
      now,
    ),
  )
  const kept = loadTarget(tx, { kind: 'settlement', id: record.id })?.value ?? null
  step(
    'keep Béďa’s settlement',
    dismissDisputeIn(tx, id('admin'), opened.id, kept, DISMISS_NOTE, now),
  )
}

export const CHORE_DISPUTE_REASON = 'Myčka je plná každý den, 3 body jsou málo.'

/**
 * A chore's score in dispute (#222), after `templates` and `disputes`: Béďa disputes the agreed
 * "Vyndat myčku", so Sporné on Správa has a chore card that opens the chore's page.
 */
export const choreDispute: Piece = ({ tx, id, now }) => {
  const dishes = tx
    .select({ id: templateTable.id })
    .from(templateTable)
    .where(and(eq(templateTable.title, 'Vyndat myčku'), eq(templateTable.status, 'active')))
    .get()
  if (!dishes) throw new Error('Demo seed: no active "Vyndat myčku"')
  step(
    'dispute "Vyndat myčku"',
    openDisputeIn(
      tx,
      id('mladsi'),
      { kind: 'template_score', id: dishes.id },
      CHORE_DISPUTE_REASON,
      now,
    ),
  )
}

export const ADJUSTMENT_REASON = 'Pomohla s velkým nákupem navíc a odnesla tašky až nahoru.'
export const CORRECTION_REASON = 'Kapesné za minulý týden nedostal, body se mu vrací.'

/**
 * Corrections and adjustments (#48), after `disputes`: the admin adds 5 points to Anička by hand
 * and corrects Béďa's past week to Bez kapesného (a correction down gives points back, so it
 * can never go below zero); Béďa disputes the corrected week and Anička her adjustment, so
 * Sporné shows Opravit on both kinds.
 */
export const corrections: Piece = ({ tx, id, now }) => {
  const admin = id('admin')
  const plus = step(
    'adjust Anička +5',
    adjustPointsIn(
      tx,
      admin,
      { takerId: id('starsi'), points: 5, reason: ADJUSTMENT_REASON },
      null,
      now,
    ),
  )
  const record = tx
    .select({ id: settlements.id })
    .from(settlements)
    .where(eq(settlements.takerId, id('mladsi')))
    .get()
  if (!record) throw new Error('Demo seed: no settlement for Béďa')
  step(
    'correct Béďa’s past week',
    correctSettlementIn(
      tx,
      admin,
      { settlementId: record.id, level: 'none', reason: CORRECTION_REASON },
      null,
      now,
    ),
  )
  step(
    'dispute the corrected week',
    openDisputeIn(
      tx,
      id('mladsi'),
      { kind: 'settlement', id: record.id },
      'Kapesné jsem nakonec dostal, tak to má být Spodní hranice.',
      now,
    ),
  )
  step(
    'dispute the +5',
    openDisputeIn(
      tx,
      id('starsi'),
      { kind: 'adjustment', id: plus.adjustmentId },
      'Nákup byl obrovský, bylo to spíš za 10.',
      now,
    ),
  )
}

/**
 * Instances (#38), after `templates`: Béďa's Zapsat of the dishwasher, waiting for a parent;
 * Anička's, rejected by Táta without a reason (§5.5), so Týden and Úkoly show "Zamítnuto"; then
 * Táta's "+ Teď" on the school bag (due the next day 7:00). The logs come first: Zapsat refuses
 * a chore already on the board (Jakub 2026-11-22), so the bag's tile says it is taken
 * while the dishwasher stays loggable.
 */
export const instances: Piece = ({ tx, id, now }) => {
  const byTitle = (title: string) => {
    const t = tx.select().from(templateTable).where(eq(templateTable.title, title)).get()
    if (!t) throw new Error(`Demo seed: no template "${title}"`)
    return t
  }
  const dishes = byTitle('Vyndat myčku')
  const bag = byTitle('Nachystat tašku do školy')
  step('Zapsat "Vyndat myčku"', selfLogInstance(tx, id('mladsi'), dishes.id, dishes.score, now))
  const logged = step(
    'Zapsat "Vyndat myčku" (Anička)',
    selfLogInstance(tx, id('starsi'), dishes.id, dishes.score, now),
  )
  step('reject "Vyndat myčku"', rejectTask(tx, id('tata'), logged.id, undefined, now))
  step('+ Teď "Nachystat tašku do školy"', createOnDemandInstance(tx, id('tata'), bag.id, now))
}

/** A job failure inside the seed must fail the seed, not be logged and skipped. */
const SEED_LOG = {
  error: (message: string, err?: unknown) => {
    throw new Error(`Demo seed: ${message}`, { cause: err })
  },
}

/** Two templates on an everyday schedule (#39), so previews show scheduled rows at any hour. */
const DEMO_SCHEDULED: readonly NewTemplate[] = [
  {
    title: 'Vyměnit kočce vodu',
    score: 1,
    approvalRequired: true,
    schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: { hour: 7, minute: 0 } },
    deadline: null,
  },
  {
    title: 'Nakrmit rybičky',
    score: 1,
    approvalRequired: true,
    schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: { hour: 18, minute: 0 } },
    // A slot's grace ends 25 h after it: the one made below has always expired by `now`.
    deadline: { dayOffset: 1, due: { hour: 18, minute: 0 }, graceMinutes: 60 },
  },
]

/**
 * #39, early in the past week (only through `pastWeekScheduled`): Táta makes both everyday
 * templates and Anička agrees, then a scheduler tick a day later makes one instance of each.
 * The rest happens at the boot tick (`bootTick`).
 */
const schedule: Piece = ({ tx, id, start }) => {
  const agreeAt = new Date(start.getTime() + 4 * HOUR)
  for (const input of DEMO_SCHEDULED) {
    const made = step(`template "${input.title}"`, createTemplateIn(tx, id('tata'), input, agreeAt))
    step(
      `approve "${input.title}"`,
      approveTemplateScoreIn(tx, id('starsi'), made.id, input.score, agreeAt),
    )
  }
  createScheduledInstances(tx, new Date(agreeAt.getTime() + 26 * HOUR), SEED_LOG)
}

/**
 * The scheduler's boot tick (#39), as a preview's first boot runs it; last in a seed. With
 * `pastWeekScheduled`: the fish's earlier copy expires and its latest missed slot is made, the
 * cat's water stays open.
 */
export const bootTick: Piece = ({ tx, now }) => {
  expireOverdueInstances(tx, now, SEED_LOG)
  createScheduledInstances(tx, now, SEED_LOG)
}

/**
 * #43: an open proposal of each kind, so Příští týden, Výchozí týden and the Domů rows have
 * something to show. Anička proposes next week at 60/120 with the default end, and Táta agrees,
 * so Béďa is still waiting; Táta proposes a 14-day default week at 60/120, waiting for both
 * boys. Starts the first week now if no earlier piece did.
 */
export const proposals: Piece = ({ tx, id, now }) => {
  const defaults = getPeriodDefaults(tx)
  rollPeriods(tx, now, defaults)
  const running = currentPeriod(tx, now)
  if (!running) throw new Error('Demo seed: no running week for proposals')
  const levels = { lower: 60, upper: 120 }
  const next = nextPeriod(running, defaults, null)
  const period = step(
    'propose next week',
    proposePeriod(tx, id('starsi'), { cutoffAt: next.cutoffAt, levels }, now),
  )
  step('agree next week', approveProposal(tx, id('tata'), 'period', period.id, now))
  step(
    'propose default week',
    proposeDefaultsChange(tx, id('tata'), { ...defaults, lengthDays: 14, levels }, now),
  )
}

/** The week plan's chores (#257): one every day, one twice a week with a deadline. */
export const WEEK_CHORES: readonly NewTemplate[] = [
  {
    title: 'Nakrmit kočku',
    score: 3,
    approvalRequired: true,
    schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: null },
    deadline: null,
  },
  {
    title: 'Vynést tříděný odpad',
    score: 4,
    approvalRequired: true,
    schedule: { days: [2, 5], time: { hour: 18, minute: 0 } },
    deadline: { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 60 },
  },
]

/**
 * #257: Táta's two week-plan chores, agreed by Anička, and the running week's copies of them
 * (the `weekPlan` switch is set after the pieces, so this piece makes them itself). With no week
 * running yet it starts one at today's 00:00 Prague and agrees the chores then, so today's slot
 * is inside the window whatever the hour; inside a seed that already runs a week (`demo`) they
 * are agreed now, so the audit log stays in time order, and their copies start with the next slot.
 */
export const weekChores: Piece = ({ tx, id, now }) => {
  const defaults = getPeriodDefaults(tx)
  let agreeAt = now
  if (!currentPeriod(tx, now)) {
    agreeAt = startOfPragueDay(now)
    rollPeriods(tx, agreeAt, defaults)
  }
  const made = WEEK_CHORES.map((input) => {
    const t = step(`template "${input.title}"`, createTemplateIn(tx, id('tata'), input, agreeAt))
    step(
      `approve "${input.title}"`,
      approveTemplateScoreIn(tx, id('starsi'), t.id, t.score, agreeAt),
    )
    return t
  })
  rollPeriods(tx, now, defaults)
  // Only these chores: the other pieces' scheduled chores keep their old-rule instances.
  for (const t of made) makeWeekCopies(tx, now, { templateId: t.id, log: SEED_LOG })
}

/**
 * Test only (#259, seed `planmeeting`), not in `demo`: the running week on its last day, so e2e
 * settles it at Schůzka on any weekday with the last-day rule on, as a real meeting does: the
 * week ends now and the next one starts with its copies. The default week ends at tomorrow's
 * weekday 00:00, so today is the last day. The family starts in a short first week (from
 * `start`, a week ago, to six days ago 00:00; the audit log stays in time order) where Táta
 * agrees the plan table's chores with Anička; Táta settles it with no points. The running week
 * runs from six days ago 00:00 to tomorrow 00:00 with a copy for every slot: the brothers did
 * the past days' everyday chores and Táta approved them (points to settle), the bin's past copies
 * expired, and today's copies are open. Nothing waits for approval. Must come first in a seed: it writes at
 * `start`.
 */
export const lastDayWeek: Piece = ({ tx, id, now, start }) => {
  const tata = id('tata')
  const tomorrow = addPragueDays(startOfPragueDay(now), 1)
  const cutoff = { weekday: toPragueWallTime(tomorrow).weekday, hour: 0, minute: 0 }
  const weekly = { ...getPeriodDefaults(tx), lengthDays: 7, cutoff }
  const runningFrom = addPragueDays(tomorrow, -7)
  // A one-day length makes the first week end at the nearest cutoff: six days ago 00:00.
  rollPeriods(tx, start, { ...weekly, lengthDays: 1 })
  const first = listPeriods(tx)[0]
  if (first?.cutoffAt.getTime() !== runningFrom.getTime())
    throw new Error('Demo seed: the first week does not end six days ago')
  writePeriodDefaults(tx, { kind: 'system' }, weekly, start)
  const [vacuum, table, flowers, bin] = PLAN_CHORES.map((input) => {
    const t = step(`template "${input.title}"`, createTemplateIn(tx, tata, input, start))
    step(`approve "${input.title}"`, approveTemplateScoreIn(tx, id('starsi'), t.id, t.score, start))
    return t.id
  })
  if (vacuum === undefined || table === undefined || flowers === undefined || bin === undefined)
    throw new Error('Demo seed: plan chores missing')
  rollPeriods(tx, runningFrom, getPeriodDefaults(tx))
  for (const t of [vacuum, table, flowers, bin])
    makeWeekCopies(tx, runningFrom, { templateId: t, log: SEED_LOG })
  const settleAt = new Date(runningFrom.getTime() + 8 * HOUR)
  const meeting = getMeeting(tx, settleAt, true)
  if (!meeting.period) throw new Error('Demo seed: nothing to settle')
  if (meeting.period.id !== first.id) throw new Error('Demo seed: the first week is not due')
  const shown = meeting.takers.map((t) => ({ takerId: t.id, total: t.total }))
  step('settle the first week', settlePeriod(tx, tata, first.id, shown, settleAt, true))
  const copyOn = (templateId: number, day: Date) => {
    const row = tx
      .select()
      .from(taskTable)
      .where(and(eq(taskTable.templateId, templateId), eq(taskTable.planDayAt, toIsoUtc(day))))
      .get()
    if (!row) throw new Error(`Demo seed: no copy of template ${String(templateId)}`)
    return row.id
  }
  // Six past days (0 = six days ago): who did what, done at 18:00 and approved at 19:00. Anička
  // ends at 50, the lower level; Béďa at 16, below it.
  const done: readonly (readonly [string, number, readonly number[]])[] = [
    ['starsi', flowers, [0, 1, 2, 3, 4, 5]],
    ['starsi', vacuum, [0, 1, 2, 3, 4]],
    ['starsi', table, [5]],
    ['mladsi', table, [0, 1, 2, 3, 4]],
    ['mladsi', vacuum, [5]],
  ]
  for (let d = 0; d < 6; d++) {
    const day = addPragueDays(runningFrom, d)
    const evening = new Date(day.getTime() + 18 * HOUR)
    const mine = done.filter(([, , days]) => days.includes(d))
    const ids = mine.map(([by, t]) => {
      const task = copyOn(t, day)
      step(`day ${String(d)}: done`, completeTask(tx, id(by), task, evening, true))
      return task
    })
    const approveAt = new Date(evening.getTime() + HOUR)
    for (const task of ids)
      step(`day ${String(d)}: approved`, approveTask(tx, tata, task, approveAt))
  }
  // The rest of the past days' copies expire, as the scheduler's expiry does.
  expireOverdueInstances(tx, now, SEED_LOG, true)
}

/** The plan table's chores (#258): three every day (one with the long name), one twice a week. */
export const PLAN_CHORES: readonly NewTemplate[] = [
  {
    title: 'Vyluxovat celý obývák a chodbu',
    score: 6,
    approvalRequired: true,
    schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: null },
    deadline: null,
  },
  {
    title: 'Prostřít stůl k večeři',
    score: 2,
    approvalRequired: true,
    schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: null },
    deadline: null,
  },
  {
    title: 'Zalít kytky na balkoně',
    score: 3,
    approvalRequired: true,
    schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: null },
    deadline: null,
  },
  {
    title: 'Vynést koš na plasty',
    score: 4,
    approvalRequired: true,
    schedule: { days: [2, 5], time: { hour: 18, minute: 0 } },
    deadline: { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 60 },
  },
]

/**
 * #258: Táta's four plan-table chores, agreed by Anička, with their week copies. With no week
 * running yet (seed `plantable`) the week starts at yesterday's 00:00 Prague and the chores are
 * agreed then, so yesterday is a column: Anička's "Zalít kytky" there is confirmed and
 * "Vyluxovat…" expired. Inside a seed that already runs a week (`demo`) they are agreed now and
 * their copies start with the next slot. Then today's copies, where there are: Béďa holds
 * "Vyluxovat…", Anička's "Zalít kytky" waits for approval, "Prostřít stůl" stays free; Anička
 * holds the next "Vyluxovat…" after today. No on-demand extra: the switch is off while pieces run.
 */
export const planTable: Piece = ({ tx, id, now }) => {
  const defaults = getPeriodDefaults(tx)
  const today = startOfPragueDay(now)
  const yesterday = currentPeriod(tx, now) ? null : addPragueDays(today, -1)
  if (yesterday) rollPeriods(tx, yesterday, defaults)
  const agreeAt = yesterday ?? now
  const [vacuum, table, flowers, bin] = PLAN_CHORES.map((input) => {
    const t = step(`template "${input.title}"`, createTemplateIn(tx, id('tata'), input, agreeAt))
    step(
      `approve "${input.title}"`,
      approveTemplateScoreIn(tx, id('starsi'), t.id, t.score, agreeAt),
    )
    if (yesterday) makeWeekCopies(tx, yesterday, { templateId: t.id, log: SEED_LOG })
    return t.id
  })
  if (vacuum === undefined || table === undefined || flowers === undefined || bin === undefined)
    throw new Error('Demo seed: plan chores missing')
  const copies = (templateId: number) =>
    tx
      .select()
      .from(taskTable)
      .where(eq(taskTable.templateId, templateId))
      .orderBy(taskTable.planDayAt, taskTable.id)
      .all()
      .filter((r) => r.planDayAt !== null)
  const on = (templateId: number, day: Date) =>
    copies(templateId).find((r) => r.planDayAt === toIsoUtc(day))?.id
  if (yesterday) {
    const done = on(flowers, yesterday)
    if (done === undefined) throw new Error("Demo seed: no copy of yesterday's flowers")
    const evening = new Date(yesterday.getTime() + 18 * HOUR)
    step("yesterday's flowers done", completeTask(tx, id('starsi'), done, evening, true))
    step(
      "yesterday's flowers approved",
      approveTask(tx, id('tata'), done, new Date(evening.getTime() + HOUR)),
    )
  }
  rollPeriods(tx, now, defaults)
  for (const t of [vacuum, table, flowers, bin])
    makeWeekCopies(tx, now, { templateId: t, log: SEED_LOG })
  if (yesterday) {
    const over = on(vacuum, yesterday)
    if (over !== undefined) step("yesterday's vacuum expired", expireTask(tx, over, now, true))
  }
  const vacuumToday = on(vacuum, today)
  if (vacuumToday !== undefined)
    step('Béďa holds the vacuum', reserveTask(tx, id('mladsi'), vacuumToday, now, true))
  const flowersToday = on(flowers, today)
  if (flowersToday !== undefined)
    step('Anička waters the flowers', completeTask(tx, id('starsi'), flowersToday, now, true))
  const later = copies(vacuum).find((r) => r.planDayAt !== null && r.planDayAt > toIsoUtc(today))
  if (later) step('Anička holds a later vacuum', reserveTask(tx, id('starsi'), later.id, now, true))
}

/**
 * #247: four suggestions from Profil. Two still new (Anička's with a two-line description,
 * Béďa's with none), Táta's marked done and one of Anička's dismissed by the admin. None sent:
 * that needs GitHub.
 */
export const suggestions: Piece = ({ tx, id, now }) => {
  const suggest = (by: string, title: string, description = '') =>
    step(`suggest "${title}"`, createSuggestionIn(tx, id(by), { title, description }, now))
  suggest(
    'starsi',
    'Tmavý režim i na obrazovce Týden',
    'Večer mě to světlo oslňuje.\nNa Domů už tmavý režim funguje.',
  )
  suggest('mladsi', 'Zvuk, když dokončím úkol')
  const meeting = suggest('tata', 'Připomenout v neděli schůzku')
  const bins = suggest('starsi', 'Víc bodů za vynesení koše')
  step('done', closeSuggestionIn(tx, id('admin'), meeting.id, 'done', now))
  step('dismiss', closeSuggestionIn(tx, id('admin'), bins.id, 'dismiss', now))
}

// ── The public demo (#356): `demo` only, so a presenter shows every feature on any day ──

/** The demo's past week: Anička 105 → horní, 100 off, 5 carried; Béďa 50 → spodní, 0. */
const DEMO_PAST_WEEK: typeof PAST_WEEK = [
  { by: 'starsi', title: 'Vytřít podlahu', score: 60 },
  { by: 'starsi', title: 'Uklidit garáž', score: 45 },
  { by: 'mladsi', title: 'Vyčistit kočičí záchod', score: 50 },
]

const daily = (title: string, score: number): NewTemplate => ({
  title,
  score,
  approvalRequired: true,
  schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: null },
  deadline: null,
})

/** The demo's week plan: four chores every day, the plastics bin twice a week. */
export const DEMO_CHORES: readonly NewTemplate[] = [
  daily('Nakrmit kočku', 3),
  daily('Vyluxovat pokoj', 6),
  daily('Prostřít stůl k večeři', 2),
  daily('Ustlat postel', 3),
  {
    title: 'Vynést koš na plasty',
    score: 4,
    approvalRequired: true,
    schedule: { days: [2, 5], time: { hour: 18, minute: 0 } },
    deadline: { dayOffset: 1, due: { hour: 7, minute: 0 }, graceMinutes: 60 },
  },
]

/** The running week's past days (0 = its first): who did which chore (index above), at 18:00. */
const DEMO_DONE: readonly (readonly [string, number, readonly number[]])[] = [
  ['mladsi', 0, [0, 1, 2, 3, 4]],
  ['mladsi', 1, [1]],
  ['starsi', 2, [0, 1, 2]],
  ['starsi', 3, [0, 1, 2, 3, 4]],
]

function demoCopy(tx: Tx, templateId: number | undefined, day: Date): number {
  const row = tx
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(and(eq(taskTable.templateId, templateId ?? 0), eq(taskTable.planDayAt, toIsoUtc(day))))
    .get()
  if (!row) throw new Error(`Demo seed: no copy of chore ${String(templateId)}`)
  return row.id
}

/**
 * The demo's weeks: a short settled past week (from `start`), then the running week from five
 * days ago 00:00 to tomorrow 00:00, so today is its last day and Táta can approve and settle at
 * Schůzka all day (`settleLastDay`); after midnight it waits for its meeting. The demo's chores
 * are agreed at its start, so its plan has past days: done and approved, Anička's bed from
 * yesterday waiting, the fourth day's table cancelled, the rest expire in `demoToday`. "Ustlat
 * postel" had its price changed 3 → 4 on the first day. Must come first in a seed.
 */
export const demoWeek: Piece = (ctx) => {
  const { tx, now } = ctx
  const tomorrow = addPragueDays(startOfPragueDay(now), 1)
  const from = addPragueDays(tomorrow, -6)
  const cutoff = { weekday: toPragueWallTime(tomorrow).weekday, hour: 0, minute: 0 }
  const weekly = { ...getPeriodDefaults(tx), lengthDays: 7, cutoff }
  const defaults = () => {
    writePeriodDefaults(tx, { kind: 'system' }, weekly, from)
  }
  const plan = (c: SeedContext) => {
    demoPlan(c, from)
  }
  pastWeekWith(ctx, [defaults], { chores: DEMO_PAST_WEEK, settleAt: from, after: [plan] })
  if (currentPeriod(tx, now)?.cutoffAt.getTime() !== tomorrow.getTime())
    throw new Error('Demo seed: the running week does not end tomorrow')
}

function demoPlan({ tx, id }: SeedContext, from: Date): void {
  const tata = id('tata')
  const ids = DEMO_CHORES.map((input) => {
    const t = step(`template "${input.title}"`, createTemplateIn(tx, tata, input, from))
    step(`approve "${input.title}"`, approveTemplateScoreIn(tx, id('starsi'), t.id, t.score, from))
    makeWeekCopies(tx, from, { templateId: t.id, log: SEED_LOG })
    return t.id
  })
  const [, , table, bed = 0] = ids
  const hour = (day: Date, h: number) => new Date(day.getTime() + h * HOUR)
  step('bid 5 on the bed', bidOnTemplateIn(tx, id('mladsi'), bed, 5, hour(from, 8)))
  step('bid 4 on the bed', bidOnTemplateIn(tx, id('starsi'), bed, 4, hour(from, 9)))
  step('take 4 on the bed', acceptLowestBidOnTemplateIn(tx, tata, bed, 4, hour(from, 12)))
  for (let d = 0; d < 5; d++) {
    const day = addPragueDays(from, d)
    if (d === 3) {
      const why = 'Večeříme u babičky.'
      step('cancel the table', cancelTask(tx, tata, demoCopy(tx, table, day), why, hour(day, 12)))
    }
    const done = DEMO_DONE.filter(([, , days]) => days.includes(d)).map(([by, chore]) => {
      const task = demoCopy(tx, ids[chore], day)
      step(`day ${String(d)}: done`, completeTask(tx, id(by), task, hour(day, 18), true))
      return [by, task] as const
    })
    for (const [by, task] of done) {
      if (d === 4 && by === 'starsi') continue
      step(`day ${String(d)}: approved`, approveTask(tx, tata, task, hour(day, 19)))
    }
  }
}

/** Done this week in the demo: few points, so Anička stays below spodní and Béďa between. */
const DEMO_THIS_WEEK: typeof THIS_WEEK = [
  { by: 'starsi', title: 'Vysát auto', score: 8, approved: true },
  { by: 'mladsi', title: 'Umýt nádobí', score: 8, approved: true },
  { by: 'starsi', title: 'Uklidit hračky', score: 3, approved: false },
  { by: 'mladsi', title: 'Vynést papír', score: 3, approved: false },
]

/** The demo's one-time work this week, and an agreed task for Volné. */
export const demoThisWeek: Piece = (ctx) => {
  thisWeekWith(ctx, DEMO_THIS_WEEK)
  const windows = offer(ctx, 'Umýt okna v obýváku i v ložnici', 5)
  step('agree "Umýt okna"', approveTaskOffer(ctx.tx, ctx.id('starsi'), windows.id, 5, ctx.now))
}

/** Today in the demo plan: Béďa holds the vacuum, Anička the bed and set the table; past days' leftovers expire. */
export const demoToday: Piece = ({ tx, id, now }) => {
  const today = startOfPragueDay(now)
  const [, vacuum, table, bed] = DEMO_CHORES.map(
    (c) => tx.select().from(templateTable).where(eq(templateTable.title, c.title)).get()?.id,
  )
  const copy = (t: number | undefined) => demoCopy(tx, t, today)
  step('Béďa holds the vacuum', reserveTask(tx, id('mladsi'), copy(vacuum), now, true))
  step('Anička holds the bed', reserveTask(tx, id('starsi'), copy(bed), now, true))
  step('Anička set the table', completeTask(tx, id('starsi'), copy(table), now, true))
  expireOverdueInstances(tx, now, SEED_LOG, true)
}
