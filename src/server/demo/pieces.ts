import { eq } from 'drizzle-orm'
import type { Tx } from '~/server/audit'
import { nextPeriod } from '~/domain'
import { templates as templateTable } from '~/server/db/schema'
import { createOnDemandInstance, selfLogInstance } from '~/server/instances'
import {
  approveProposal,
  currentPeriod,
  getPeriodDefaults,
  listPeriods,
  proposeDefaultsChange,
  proposePeriod,
  rollPeriods,
} from '~/server/periods'
import { getMeeting, settlePeriod } from '~/server/settlement/meeting'
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
import { approveTemplateScoreIn, createTemplateIn } from '~/server/templates/templates'
import type { NewTemplate } from '~/server/templates/templates'
import { bidOnTemplateIn, counterOnTemplateIn } from '~/server/templates/scoreChange'

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
 * #34 and #150: "Umýt auto" in negotiation (Táta offers 18, Starší bids 25, Mladší 22),
 * "Uklidit sklep", a plain offer of 10 with no bids, and a task reserved to Starší through a
 * bidder's yes ("Beru za 8"), so his Domů row and the task page show Hotovo and Uvolnit. A long
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

/** #36: an open task at 10 with Táta's new price 12 waiting for the brothers. */
export const priceChange: Piece = (ctx) => {
  const { tx, id, now } = ctx
  const rake = offer(ctx, 'Shrabat listí na zahradě', 10)
  step('agree 10', approveTaskOffer(tx, id('mladsi'), rake.id, 10, now))
  step('new price 12', proposeTaskScoreChange(tx, id('tata'), rake.id, 12, now))
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
 * Starší 40 confirmed + 12 pending (below spodní 50) and Mladší 55 confirmed (past it). Plus an
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
 * Three templates (#37): the bins wait for a boy's yes, the dishwasher is agreed, with a score
 * change in flight (#138): Mladší bids 5, Táta offers 4; the school bag is agreed with a
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
  step(`reserve ${what}`, reserveTask(tx, id(by), made.id, at))
  step(`done ${what}`, completeTask(tx, id(by), made.id, at))
  return made.id
}

/** Last week (#45), settled: Starší 108 → horní, 100 off, 8 carried; Mladší 50 → spodní, 0. */
const PAST_WEEK: readonly { by: string; title: string; score: number }[] = [
  { by: 'starsi', title: 'Vytřít podlahu', score: 60 },
  { by: 'starsi', title: 'Uklidit garáž', score: 48 },
  { by: 'mladsi', title: 'Nakrmit kočku', score: 50 },
]

/**
 * The settled past week (#45), so Týden → Historie has a record: the first period starts at
 * `start` (a week ago), three chores are done in it, and Táta settles it an hour before its
 * cutoff or an hour ago, whichever is first. That starts this week. Then Táta rejects one of
 * Mladší's chores in this week, so Týden shows a rejection. Must come first in a seed: it
 * writes at `start`, and the audit log reads in time order.
 */
export const pastWeek: Piece = (ctx) => {
  const { tx, id, start, now } = ctx
  const tata = id('tata')
  rollPeriods(tx, start, getPeriodDefaults(tx))
  PAST_WEEK.forEach((chore, i) => {
    const at = new Date(start.getTime() + (i + 1) * HOUR)
    const task = doChore(ctx, chore.by, chore.title, chore.score, at)
    step(`approve "${chore.title}"`, approveTask(tx, tata, task, at))
  })
  const week = listPeriods(tx)[0]
  if (!week) throw new Error('Demo seed: no past week')
  const settleAt = new Date(Math.min(week.cutoffAt.getTime() - HOUR, now.getTime() - HOUR))
  const meeting = getMeeting(tx, settleAt)
  if (!meeting.period) throw new Error('Demo seed: nothing to settle')
  const shown = meeting.takers.map((t) => ({ takerId: t.id, total: t.total }))
  step('settle', settlePeriod(tx, tata, week.id, shown, settleAt))
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
  for (const chore of THIS_WEEK) {
    const task = doChore(ctx, chore.by, chore.title, chore.score, ctx.now)
    if (chore.approved) {
      step(`approve "${chore.title}"`, approveTask(ctx.tx, ctx.id('tata'), task, ctx.now))
    }
  }
}

/**
 * Instances (#38), after `templates`: Mladší's Zapsat of the dishwasher, waiting for a parent;
 * Starší's, rejected by Táta without a reason (§5.5), so Týden and Úkoly show "Zamítnuto"; then
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
    'Zapsat "Vyndat myčku" (Starší)',
    selfLogInstance(tx, id('starsi'), dishes.id, dishes.score, now),
  )
  step('reject "Vyndat myčku"', rejectTask(tx, id('tata'), logged.id, undefined, now))
  step('+ Teď "Nachystat tašku do školy"', createOnDemandInstance(tx, id('tata'), bag.id, now))
}

/**
 * #43: an open proposal of each kind, so Příští týden, Výchozí týden and the Domů rows have
 * something to show. Starší proposes next week at 60/120 with the default end, and Táta agrees,
 * so Mladší is still waiting; Táta proposes a 14-day default week at 60/120, waiting for both
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
