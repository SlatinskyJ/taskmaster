import { Link } from '@tanstack/react-router'
import { ChevronRight, Loader2, Plus } from 'lucide-react'
import { Avatar } from '~/components/shell/Avatar'
import { STATE_STRIPE } from '~/components/tasks/stateStyles'
import { Button } from '~/components/ui/button'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '~/components/ui/drawer'
import type { ItemStateKey } from '~/lib/strings'
import { cs, formatPoints } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { PlanCopy, PlanRow } from '~/server/instances/functions'
import { dayHeader, listRowAction, listRowLabel } from './planView'
import type { Viewer } from './planView'

// The plan table's two sheets (#258, wireframes 3 and 5): Uvolnit on a brother's own cell, and
// the list of several copies on one day. Their bodies are hook-free, so tests render them
// without the drawer.

/** "Prostřít stůl k večeři · St 2. 12." */
export function sheetTitle(row: Pick<PlanRow, 'title'>, day: string): string {
  const { weekday, date } = dayHeader(day)
  return `${row.title} · ${weekday} ${date}`
}

const taskLink = (copy: PlanCopy) => ({
  to: '/ukol/$taskId' as const,
  params: { taskId: String(copy.id) },
})

const Spinner = () => (
  <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
)

/** Under the title: the points, Uvolnit, Zavřít and the task page. */
export function ReleaseSheetBody({
  copy,
  busy,
  onRelease,
  onClose,
}: {
  copy: PlanCopy
  busy: boolean
  onRelease: () => void
  onClose: () => void
}) {
  return (
    <div className="grid gap-3">
      <p className="text-meta text-muted">{cs.plan.reservedByYou(formatPoints(copy.score))}</p>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="no" disabled={busy} aria-busy={busy || undefined} onClick={onRelease}>
          {busy ? <Spinner /> : null}
          {cs.work.release}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {cs.plan.close}
        </Button>
      </div>
      <Link
        {...taskLink(copy)}
        className="inline-flex min-h-tap items-center justify-center gap-1 font-display font-semibold text-accent-strong"
      >
        {cs.plan.openTask}
        <ChevronRight aria-hidden className="size-4" />
      </Link>
    </div>
  )
}

export function ReleaseSheet({
  open,
  onOpenChange,
  row,
  day,
  copy,
  viewer,
  busy,
  onRelease,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: PlanRow
  day: string
  copy: PlanCopy
  viewer: Viewer
  busy: boolean
  onRelease: () => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader className="flex items-center gap-3">
          <Avatar userId={viewer.id} name={copy.person?.name ?? ''} />
          <DrawerTitle className="min-w-0 break-words">{sheetTitle(row, day)}</DrawerTitle>
        </DrawerHeader>
        <ReleaseSheetBody
          copy={copy}
          busy={busy}
          onRelease={onRelease}
          onClose={() => {
            onOpenChange(false)
          }}
        />
      </DrawerContent>
    </Drawer>
  )
}

const STRIPE: Record<PlanCopy['status'], ItemStateKey> = {
  open: 'open',
  reserved: 'reserved',
  done_unconfirmed: 'pending',
  confirmed: 'confirmed',
  expired: 'expired',
  cancelled: 'cancelled',
}

function RowContent({ copy, text }: { copy: PlanCopy; text: string }) {
  return (
    <>
      {copy.person ? (
        <Avatar userId={copy.person.id} name={copy.person.name} size="sm" />
      ) : (
        <Plus aria-hidden className="size-[26px] shrink-0 text-state-open-text" />
      )}
      <span className="min-w-0 flex-1 break-words">{text}</span>
    </>
  )
}

/** A row per copy: a brother's free and own rows are buttons, every other row opens the page. */
export function CopyListBody({
  copies,
  viewer,
  busyId,
  onAction,
}: {
  copies: PlanCopy[]
  viewer: Viewer
  busyId: number | null
  onAction: (action: 'reserve' | 'release', copy: PlanCopy) => void
}) {
  const rowClass = (copy: PlanCopy) =>
    cn(
      'flex min-h-tap w-full items-center gap-3 rounded-card border-l-4 bg-bg px-3 py-2 text-left text-row',
      STATE_STRIPE[STRIPE[copy.status]],
    )
  return (
    <ul className="grid gap-2">
      {copies.map((copy) => {
        const label = listRowLabel(copy, viewer)
        const act = listRowAction(copy, viewer)
        const busy = busyId === copy.id
        return (
          <li key={copy.id}>
            {act === 'open' ? (
              <Link {...taskLink(copy)} className={rowClass(copy)}>
                <RowContent copy={copy} text={label.what} />
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
              </Link>
            ) : (
              <div className={rowClass(copy)}>
                <RowContent copy={copy} text={label.what} />
                <Button
                  variant={act === 'release' ? 'no' : 'primary'}
                  disabled={busyId !== null}
                  aria-busy={busy || undefined}
                  onClick={() => {
                    onAction(act, copy)
                  }}
                >
                  {busy ? <Spinner /> : null}
                  {label.action}
                </Button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function CopyListSheet({
  open,
  onOpenChange,
  row,
  day,
  copies,
  viewer,
  busyId,
  onAction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: PlanRow
  day: string
  copies: PlanCopy[]
  viewer: Viewer
  busyId: number | null
  onAction: (action: 'reserve' | 'release', copy: PlanCopy) => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby={undefined}>
        <DrawerHeader>
          <DrawerTitle className="break-words">{sheetTitle(row, day)}</DrawerTitle>
        </DrawerHeader>
        <CopyListBody copies={copies} viewer={viewer} busyId={busyId} onAction={onAction} />
      </DrawerContent>
    </Drawer>
  )
}
