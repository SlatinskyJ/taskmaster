# Scheduler

Server-side time-driven work (#39, spec §5.3, §5.8). Started by the boot plugin
(`src/server/plugins/database.ts`), stopped by Nitro's `close` hook.

## The tick

- One croner tick every 15 minutes (`*/15 * * * *`, Europe/Prague; Jakub 2026-11-22),
  `protect` (no overlapping ticks) and `unref` (never keeps the process alive).
- What that means: a period rolls at the first tick after its cutoff (Sunday 23:59 → 00:00) but
  starts at the cutoff, so nothing done in between falls outside a period; a slot that is not on a
  quarter hour appears at the next tick (its row still shows the slot time); a copy turns Prošlo
  up to 15 minutes after its grace ends (Hotovo is refused from the grace end on regardless).
- The first tick runs at once when the scheduler starts: that is the **catch-up after downtime**.
- Each tick reads `now()` once and runs every job, in order, with that instant.
- A job that throws is logged as `[scheduler] <name> failed`; the other jobs still run and the
  next tick runs it again. Nothing is thrown out of the scheduler.

## Jobs (`jobs.ts`), in order

1. `periods`: `rollPeriods` makes the first period and one for every passed cutoff; logs
   `[periods] started <start> → <cutoff>`. Period defaults are read on every tick.
2. `weekRules` (#257): only while the `weekPlan` switch is off, `dropWeekRules` turns
   `week_rules` off on every task that has it (`instance.week_rules_dropped`, actor system), so a
   copy made while the switch was on keeps the old rules for good.
3. `expiry`: `expireOverdueInstances` expires open or reserved deadline instances whose grace
   window has ended (`instance.expired`, actor system). With the `weekPlan` switch on also every
   open or reserved no-deadline week copy whose day is over (its day rules still on, #257).
4. `instances`: `createScheduledInstances` makes one instance per schedule slot. After downtime
   only the latest missed slot counts; one already past its grace is made and expired at once.
   `template_slots` remembers the last handled slot per template. With the `weekPlan` switch on
   (#257, spec §5.12) it runs `makeWeekCopies` instead: one copy per slot of the running period,
   up to its cutoff and at most 14 days ahead, each marked with its Prague day.

## Adding a job

A job is `{ name, run(at) }`. It must work from "what should exist at `at`", so running it
twice for the same instant, or once after a long outage, gives the same result. Write every
state change with its audit entry in one transaction (`withAudit` / `writeAudit`), one
transaction per item so one failure leaves the rest. Add it to `schedulerJobs` and give it a test
over a test DB.
