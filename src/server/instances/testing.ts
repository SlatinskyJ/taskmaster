import { asc, eq } from 'drizzle-orm'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { fromPragueWallTime } from '~/domain/dates'
import type { Db } from '~/server/db'
import { featureFlags, tasks } from '~/server/db/schema'
import type { TaskRow } from '~/server/db/schema'
import { rollPeriods } from '~/server/periods'
import { T0, family, must } from '~/server/tasks/testing'
import { approveTemplateScore, createTemplate } from '~/server/templates'
import { makeWeekCopies } from './weekCopies'

// Test helpers for week copies (#257). Not imported by app code.

export const prague = (month: number, day: number, hour: number, minute = 0) =>
  fromPragueWallTime({ year: 2026, month, day, hour, minute })

/** Monday 2026-11-30 00:00 Prague: the week Mon 30.11 … Sun 6.12 starts. */
export const MON = prague(11, 30, 0)
export const MON_10 = prague(11, 30, 10)
export const WED_NOON = prague(12, 2, 12)
/** The first tick after Wednesday's midnight. */
export const THU_0005 = prague(12, 3, 0, 5)

export const setWeekPlan = (db: Db, on: boolean) =>
  db.update(featureFlags).set({ enabled: on }).where(eq(featureFlags.key, 'weekPlan')).run()

/** Every copy of a template, oldest first. */
export const copiesOf = (db: Db, templateId: number): TaskRow[] =>
  db.select().from(tasks).where(eq(tasks.templateId, templateId)).orderBy(asc(tasks.id)).all()

/**
 * The family with a week running from Monday and "Nakrmit kočku" (every day 18:00, no deadline,
 * agreed Monday 00:00). `weekPlan` on, the week's seven copies made Monday 10:00: `day[0]` is
 * Monday's … `day[6]` Sunday's.
 */
export function weekFamily() {
  const f = family()
  rollPeriods(f.db, MON, DEFAULT_PERIOD_DEFAULTS)
  const cat = must(
    createTemplate(
      f.db,
      f.tata,
      {
        title: 'Nakrmit kočku',
        score: 3,
        approvalRequired: true,
        schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: { hour: 18, minute: 0 } },
        deadline: null,
      },
      T0,
    ),
  ).id
  must(approveTemplateScore(f.db, f.starsi, cat, 3, MON))
  setWeekPlan(f.db, true)
  const day = makeWeekCopies(f.db, MON_10).map((r) => r.id)
  if (day.length !== 7) throw new Error(`expected 7 copies, got ${String(day.length)}`)
  return { ...f, cat, day }
}

export type WeekFamily = ReturnType<typeof weekFamily>
