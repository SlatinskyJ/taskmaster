import { hashSync } from '@node-rs/argon2'
import type { Db } from '~/server/db'
import { users } from '~/server/db/schema'
import {
  acceptOffer,
  approveTask,
  approveTaskOffer,
  completeTask,
  createTask,
  placeBid,
} from '~/server/tasks'
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
// brothers' points, and an open task (see seedPoints).

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
    for (const person of DEMO_USERS) {
      const created = createUser(tx, { kind: 'system' }, { ...person, passwordHash }, now)
      if (!created.ok)
        throw new Error(`Demo seed: cannot create "${person.username}": ${created.error}`)
      ids.set(person.username, created.value.id)
    }
    const id = (username: string) => ids.get(username) ?? 0
    const step = <T>(what: string, r: { ok: true; value: T } | { ok: false; error: string }) => {
      if (!r.ok) throw new Error(`Demo seed: ${what}: ${r.error}`)
      return r.value
    }
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
    seedPoints(tx, id, step, now)
    seedTemplates(tx, ids, now)
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

export function describeDemo(outcome: DemoOutcome): string | null {
  if (outcome.kind === 'skipped') {
    if (outcome.reason === 'not_empty') return '[demo] database has people already: not seeding'
    if (outcome.reason === 'admin_password_set') return '[demo] ADMIN_PASSWORD is set: not seeding'
    return null
  }
  return `[demo] seeded ${outcome.usernames.join(', ')} (password "${DEMO_PASSWORD}")`
}
