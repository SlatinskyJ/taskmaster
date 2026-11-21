import { and, asc, eq } from 'drizzle-orm'
import type { Db } from '~/server/db'
import { auditLog } from '~/server/db/schema'
import type { EntityType } from './actions'
import type { Tx } from './audit'

export type AuditLogRow = typeof auditLog.$inferSelect

/** Every entry about one entity, oldest first (the log's own order). Read-only. */
export function entityLog(
  db: Db | Tx,
  entityType: EntityType,
  entityId: number | string,
): AuditLogRow[] {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, String(entityId))))
    .orderBy(asc(auditLog.id))
    .all()
}
