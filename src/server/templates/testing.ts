import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '~/server/db'
import { auditLog, templates, templateThread } from '~/server/db/schema'
import type { Family } from '~/server/tasks/testing'
import { must, T0 } from '~/server/tasks/testing'
import { approveTemplateScore, createTemplate } from './templates'

// Test helpers for the template server modules (thread, score change). Not imported by app code.

/** "Vyndat myčku", proposed by Táta at 3 and approved by Starší: active at 3. */
export function agreedTemplate(f: Family): number {
  const input = { title: 'Vyndat myčku', score: 3, approvalRequired: true }
  const id = must(createTemplate(f.db, f.tata, { ...input, schedule: null, deadline: null }, T0)).id
  must(approveTemplateScore(f.db, f.starsi, id, 3, T0))
  return id
}

/** The template's thread rows, as `[side, userId, score, closedAs]`, oldest first. */
export const threadRows = (db: Db, templateId: number) =>
  db
    .select()
    .from(templateThread)
    .where(eq(templateThread.templateId, templateId))
    .orderBy(asc(templateThread.id))
    .all()
    .map((e) => [e.side, e.userId, e.score, e.closedAs])

/** The template's thread row ids, oldest first. */
export const threadIds = (db: Db, templateId: number) =>
  db
    .select({ id: templateThread.id })
    .from(templateThread)
    .where(eq(templateThread.templateId, templateId))
    .orderBy(asc(templateThread.id))
    .all()
    .map((e) => e.id)

/** The template's audit entries, oldest first, as `{ action, actor, kind, before, after }`. */
export const templateAudits = (db: Db, templateId: number) =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'template'), eq(auditLog.entityId, String(templateId))))
    .orderBy(asc(auditLog.id))
    .all()
    .map((a) => ({
      action: a.action,
      actor: a.actorUserId,
      kind: a.actorKind,
      before: JSON.parse(a.before ?? 'null') as unknown,
      after: JSON.parse(a.after ?? 'null') as unknown,
    }))

export const score = (db: Db, templateId: number) =>
  db.select().from(templates).where(eq(templates.id, templateId)).get()?.score
