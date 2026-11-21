import { and, asc, eq, isNull } from 'drizzle-orm'
import type { Db } from '~/server/db'
import { auditLog, tasks, taskThread, users } from '~/server/db/schema'
import { createTestDb } from '~/server/db/testing'
import { createTask } from './tasks'

// Test helpers for the task server modules (bidding, thread). Not imported by app code.

export const T0 = new Date('2026-11-17T10:00:00.000Z')
export const T1 = new Date('2026-11-17T11:00:00.000Z')
export const T2 = new Date('2026-11-17T12:00:00.000Z')
export const T3 = new Date('2026-11-17T13:00:00.000Z')

export function must<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

function addUser(db: Db, username: string, displayName: string, role: 'admin' | 'giver' | 'taker') {
  return db
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
}

/** Admin, Táta (giver) and the two brothers (takers). */
export function family() {
  const db = createTestDb()
  return {
    db,
    admin: addUser(db, 'admin', 'Admin', 'admin'),
    tata: addUser(db, 'tata', 'Táta', 'giver'),
    starsi: addUser(db, 'starsi', 'Starší', 'taker'),
    mladsi: addUser(db, 'mladsi', 'Mladší', 'taker'),
  }
}

export type Family = ReturnType<typeof family>

/** A second giver: Máma. */
export const addGiver = (f: Family) => addUser(f.db, 'mama', 'Máma', 'giver')

/** A third taker: Bratranec. */
export const addTaker = (f: Family) => addUser(f.db, 'bratranec', 'Bratranec', 'taker')

/** A `tasks` row written directly ("Umýt auto", proposed, 18, by Táta at T0), no thread rows. */
export function rawTask(f: Family): number {
  return f.db
    .insert(tasks)
    .values({
      title: 'Umýt auto',
      status: 'proposed',
      score: 18,
      approvalRequired: true,
      createdBy: f.tata,
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    })
    .returning()
    .get().id
}

/** "Umýt auto" offered by Táta for 18 through the real action. */
export const car = (f: Family): number =>
  must(createTask(f.db, f.tata, { title: 'Umýt auto', score: 18, approvalRequired: true }, T0)).id

/** The task's thread rows by id, as `[side, userId, score, closedAs]`. */
export const thread = (db: Db, taskId: number) =>
  db
    .select()
    .from(taskThread)
    .where(eq(taskThread.taskId, taskId))
    .orderBy(asc(taskThread.id))
    .all()
    .map((e) => [e.side, e.userId, e.score, e.closedAs])

/** True when the task's open giver row carries the task's score (decision 1 of the plan). */
export function offerInStep(db: Db, taskId: number): boolean {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get()
  const offer = db
    .select()
    .from(taskThread)
    .where(
      and(eq(taskThread.taskId, taskId), eq(taskThread.side, 'giver'), isNull(taskThread.closedAt)),
    )
    .get()
  return task !== undefined && offer?.score === task.score
}

/** Makes every audit write of `action` fail, so the surrounding transaction must roll back. */
export const failAuditOn = (db: Db, action: string) => {
  db.$client.exec(
    `CREATE TRIGGER fail_${action.replace('.', '_')} BEFORE INSERT ON audit_log
     WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'audit down'); END`,
  )
}

/** The task's audit action names, in order. */
export const audits = (db: Db, taskId: number) =>
  db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.entityId, String(taskId)))
    .orderBy(asc(auditLog.id))
    .all()
    .map((a) => a.action)

export const lastAudit = (db: Db) => db.select().from(auditLog).all().at(-1)

export const json = (text: string | null | undefined): unknown => JSON.parse(text ?? 'null')

export const row = (db: Db, id: number) => db.select().from(tasks).where(eq(tasks.id, id)).get()
