import { useRouter } from '@tanstack/react-router'
import { Loader2, Plus, Smartphone } from 'lucide-react'
import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { EmptyState } from '~/components/EmptyState'
import { Avatar } from '~/components/shell/Avatar'
import { PENDING_STRIPES, STATE_CHIP_BG, STATE_TEXT } from '~/components/tasks/stateStyles'
import { useTaskAction } from '~/components/tasks/useTaskAction'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { PlanCopy, PlanRow, WeekPlan } from '~/server/instances/functions'
import { releaseTaskFn, reserveTaskFn } from '~/server/tasks/functions'
import { CopyListSheet, ReleaseSheet } from './PlanSheets'
import {
  cellKind,
  cellLabel,
  dayHeader,
  isPast,
  reserveErrorMessage,
  rowMeta,
  tapAction,
} from './planView'
import type { CellKind, TapAction, Viewer } from './planView'

// The plan table (#258, spec §5.12, wireframes 2 and 4): chores × days of the running week.
// The chore names are pinned outside the days' scroll area; a portrait phone scrolls the days
// sideways, landscape fits them all. `WeekPlanTableView` is the drawing (hook-free, tested as
// static markup); `WeekPlanTable` adds the taps and sheets. Both are reused by the meeting's
// step 3 (#259).

/**
 * One height for a row on both sides, so the pinned names and the days never drift apart.
 * Portrait is tall enough for a three-line name and its days line.
 */
const ROW_H = 'h-[68px] landscape:h-[48px]'
const HEADER_H = 'h-[44px]'

const LEGEND: { label: string; swatch: string }[] = [
  {
    label: cs.state.open,
    swatch: cn(STATE_CHIP_BG.open, 'border-2 border-dashed border-state-open'),
  },
  { label: cs.plan.mine, swatch: cn(STATE_CHIP_BG.reserved, 'border-2 border-state-reserved') },
  { label: cs.state.pending, swatch: PENDING_STRIPES },
  {
    label: cs.state.confirmed,
    swatch: cn(STATE_CHIP_BG.confirmed, 'border-2 border-state-confirmed'),
  },
  { label: cs.state.expired, swatch: STATE_CHIP_BG.expired },
  {
    label: cs.state.cancelled,
    swatch: cn(STATE_CHIP_BG.cancelled, 'border-2 border-state-cancelled'),
  },
]

const Who = ({ copy }: { copy: PlanCopy }) =>
  copy.person ? <Avatar userId={copy.person.id} name={copy.person.name} size="sm" /> : null

/** What a cell looks like: its classes and what it holds. */
function cellLook(cell: Exclude<CellKind, { kind: 'blank' }>): {
  className: string
  body: ReactNode
} {
  const small = 'text-chip font-bold leading-none'
  switch (cell.kind) {
    case 'free':
      return {
        className: cn(STATE_CHIP_BG.open, 'border-2 border-dashed border-state-open'),
        body: <Plus aria-hidden className={cn('size-5', STATE_TEXT.open)} />,
      }
    case 'reserved':
      return {
        className: cell.mine
          ? cn(STATE_CHIP_BG.reserved, 'border-2 border-state-reserved')
          : 'border-2 border-track bg-surface',
        body: <Who copy={cell.copy} />,
      }
    case 'pending':
      return {
        className: PENDING_STRIPES,
        body: (
          <>
            <Who copy={cell.copy} />
            <span className={cn(small, 'rounded-sm bg-surface px-1 py-px', STATE_TEXT.pending)}>
              {cs.plan.pendingShort}
            </span>
          </>
        ),
      }
    case 'confirmed':
      return {
        className: cn(STATE_CHIP_BG.confirmed, 'border-2 border-state-confirmed'),
        body: (
          <>
            <Who copy={cell.copy} />
            <span aria-hidden className={cn(small, STATE_TEXT.confirmed)}>
              ✓
            </span>
          </>
        ),
      }
    case 'expired':
      return {
        className: STATE_CHIP_BG.expired,
        body: <span className={cn(small, STATE_TEXT.expired)}>{cs.plan.expiredShort}</span>,
      }
    case 'cancelled':
      return {
        className: cn(STATE_CHIP_BG.cancelled, 'border-2 border-state-cancelled'),
        body: <span className={cn(small, STATE_TEXT.cancelled)}>{cs.plan.cancelledShort}</span>,
      }
    case 'count':
      return {
        className: cn(STATE_CHIP_BG.open, 'border-2 border-state-open'),
        body: (
          <span className={cn('font-display text-row font-bold', STATE_TEXT.open)}>
            {cs.plan.count(cell.copies.length)}
          </span>
        ),
      }
  }
}

function DayCell({
  row,
  day,
  copies,
  plan,
  viewer,
  busyId,
  onTap,
}: {
  row: PlanRow
  day: string
  copies: PlanCopy[]
  plan: WeekPlan
  viewer: Viewer
  busyId: number | null
  onTap: (action: TapAction, copies: PlanCopy[], row: PlanRow, day: string) => void
}) {
  const cell = cellKind(copies, viewer)
  const action = tapAction(cell, viewer)
  const past = isPast(day, plan.today)
  const today = day === plan.today
  // A light dim: the past cell's text ("prošlo") stays readable, also in dark mode.
  const wrap = cn(ROW_H, 'p-0.5', past && 'opacity-70')
  if (cell.kind === 'blank' || action === null)
    return <span aria-hidden className={cn(wrap, 'block')} />
  const look = cellLook(cell)
  const busy = busyId !== null && copies.some((c) => c.id === busyId)
  return (
    <div className={wrap}>
      <button
        type="button"
        data-day={day}
        data-today={today || undefined}
        data-past={past || undefined}
        aria-label={cellLabel(row.title, day, cell, viewer)}
        aria-busy={busy || undefined}
        disabled={busyId !== null}
        onClick={() => {
          onTap(action, copies, row, day)
        }}
        className={cn(
          'flex size-full min-h-tap cursor-pointer flex-col items-center justify-center gap-0.5 rounded-button transition-transform active:translate-y-px disabled:cursor-default motion-reduce:transition-none',
          look.className,
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
        ) : (
          look.body
        )}
      </button>
    </div>
  )
}

/** Hook-free: everything a static test renders. `onTap` is called with the cell's action. */
export function WeekPlanTableView({
  plan,
  viewer,
  busyId,
  onTap,
}: {
  plan: WeekPlan
  viewer: Viewer
  busyId: number | null
  onTap: (action: TapAction, copies: PlanCopy[], row: PlanRow, day: string) => void
}) {
  if (plan.period === null) return <EmptyState>{cs.week.noPeriod}</EmptyState>
  if (plan.rows.length === 0) return <EmptyState>{cs.plan.noRows}</EmptyState>
  const n = plan.days.length
  // The column count comes from the week: a Sunday-evening start has 8 days.
  const columns = {
    '--plan-portrait': `repeat(${String(n)}, 64px)`,
    '--plan-landscape': `repeat(${String(n)}, minmax(48px, 1fr))`,
  } as CSSProperties
  return (
    <div className="grid gap-3">
      {viewer.role === 'taker' && (
        <p data-slot="tap-hint" className="hidden text-meta text-muted landscape:block">
          {cs.plan.tapHint}
        </p>
      )}
      <p
        data-slot="turn-hint"
        className="flex items-center gap-2 rounded-card bg-tint px-3 py-2 text-meta landscape:hidden"
      >
        <Smartphone aria-hidden className="size-5 shrink-0 text-accent-strong" />
        {cs.plan.turnHint}
      </p>
      <div className="flex overflow-hidden rounded-card bg-surface shadow-sticker">
        <div
          data-slot="plan-names"
          className="w-[120px] shrink-0 border-r-2 border-track landscape:w-[168px]"
        >
          <div aria-hidden className={HEADER_H} />
          {plan.rows.map((row) => (
            <div
              key={row.templateId}
              className={cn(ROW_H, 'flex flex-col justify-center overflow-hidden px-2')}
            >
              <span className="line-clamp-3 text-[14px] leading-tight font-extrabold break-words landscape:line-clamp-2">
                {row.title}
              </span>
              <span className="truncate text-[11px] leading-tight text-muted">{rowMeta(row)}</span>
            </div>
          ))}
        </div>
        <div data-slot="plan-days" className="min-w-0 flex-1 overflow-x-auto">
          <div
            className="grid portrait:grid-cols-(--plan-portrait) landscape:grid-cols-(--plan-landscape)"
            style={columns}
          >
            {plan.days.map((day) => {
              const { weekday, date } = dayHeader(day)
              const today = day === plan.today
              const [dayNumber] = date.split(' ')
              return (
                <div
                  key={day}
                  data-day={day}
                  data-header=""
                  aria-current={today ? 'date' : undefined}
                  className={cn(
                    HEADER_H,
                    'flex items-center justify-center p-1 text-meta leading-none font-bold',
                    isPast(day, plan.today) && 'text-muted',
                  )}
                >
                  <span
                    className={cn(
                      'flex flex-col items-center rounded-full px-2 py-1',
                      today && 'bg-accent-strong text-on-accent-strong',
                    )}
                  >
                    <span>{weekday}</span>
                    <span className="num text-chip">
                      {dayNumber}
                      <span className="portrait:hidden"> {date.split(' ').slice(1).join(' ')}</span>
                    </span>
                  </span>
                </div>
              )
            })}
            {plan.rows.map((row) =>
              plan.days.map((day, i) => (
                <DayCell
                  key={`${String(row.templateId)}-${day}`}
                  row={row}
                  day={day}
                  copies={row.cells[i] ?? []}
                  plan={plan}
                  viewer={viewer}
                  busyId={busyId}
                  onTap={onTap}
                />
              )),
            )}
          </div>
        </div>
      </div>
      <p data-slot="scroll-hint" className="text-meta text-muted landscape:hidden">
        {cs.plan.scrollHint}
      </p>
      <ul data-slot="plan-legend" className="flex flex-wrap gap-x-4 gap-y-2 text-meta">
        {LEGEND.map((l) => (
          <li key={l.label} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('size-4 rounded-sm', l.swatch)} />
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

type Open = { kind: 'release' | 'list'; templateId: number; day: string } | null

/** The table with its sheets and actions: what /tyden/plan and #259's step 3 render. */
export function WeekPlanTable({ plan, viewer }: { plan: WeekPlan; viewer: Viewer }) {
  const router = useRouter()
  const { busy, run } = useTaskAction()
  const [open, setOpen] = useState<Open>(null)
  const busyId = busy === null ? null : Number(busy)

  const reserve = (copy: PlanCopy, day: string) =>
    run(
      String(copy.id),
      () => reserveTaskFn({ data: { taskId: copy.id } }),
      () => cs.plan.reserved(dayHeader(day).weekday),
      { errorMessage: reserveErrorMessage },
    )
  const release = (copy: PlanCopy) =>
    run(
      String(copy.id),
      () => releaseTaskFn({ data: { taskId: copy.id } }),
      () => cs.work.toast.released,
    )

  function onTap(action: TapAction, copies: PlanCopy[], row: PlanRow, day: string) {
    const [first] = copies
    if (!first) return
    if (action === 'reserve') void reserve(first, day)
    else if (action === 'release') void release(first)
    else if (action === 'open')
      void router.navigate({ to: '/ukol/$taskId', params: { taskId: String(first.id) } })
    else setOpen({ kind: action === 'list' ? 'list' : 'release', templateId: row.templateId, day })
  }

  // The sheet reads its copies from the latest table, so it shows the reload after a tap.
  const row = open ? plan.rows.find((r) => r.templateId === open.templateId) : undefined
  const copies = open && row ? (row.cells[plan.days.indexOf(open.day)] ?? []) : []
  const close = (o: boolean) => {
    if (!o) setOpen(null)
  }
  const held = copies[0]

  return (
    <>
      <WeekPlanTableView plan={plan} viewer={viewer} busyId={busyId} onTap={onTap} />
      {open?.kind === 'release' && row && held && (
        <ReleaseSheet
          open
          onOpenChange={close}
          row={row}
          day={open.day}
          copy={held}
          viewer={viewer}
          busy={busyId === held.id}
          onRelease={() => {
            void release(held).then((ok) => {
              if (ok) setOpen(null)
            })
          }}
        />
      )}
      {open?.kind === 'list' && row && (
        <CopyListSheet
          open
          onOpenChange={close}
          row={row}
          day={open.day}
          copies={copies}
          viewer={viewer}
          busyId={busyId}
          onAction={(a, copy) => {
            void (a === 'reserve' ? reserve(copy, open.day) : release(copy))
          }}
        />
      )}
    </>
  )
}
