import { useRef } from 'react'
import { EmptyState } from '~/components/EmptyState'
import { useTaskAction } from '~/components/tasks/useTaskAction'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { cs } from '~/lib/strings'
import { selfLogFn } from '~/server/instances/functions'

// Zapsat (#38, UI doc §7.1 TLog): a brother logs a chore he did unprompted. A tile per agreed
// template; a tap asks first (he cannot take a log back, UI doc §5), then it arrives done and
// waits for a parent (spec §5.3).

export interface LogTile {
  id: number
  title: string
  score: number
}

/** Two columns of tiles; the name wraps up to three lines, the points never wrap. */
export function LogTiles({
  templates,
  onPick,
}: {
  templates: readonly LogTile[]
  onPick: (tile: LogTile) => void
}) {
  if (templates.length === 0) return <EmptyState>{cs.log.empty}</EmptyState>
  return (
    <ul className="grid grid-cols-2 gap-2">
      {templates.map((t) => (
        <li key={t.id} className="grid">
          <Button
            variant="ghost"
            aria-label={cs.log.tileLabel(t.title, t.score)}
            className="h-full min-h-tap flex-col items-start justify-between py-3 text-left whitespace-normal"
            onClick={() => {
              onPick(t)
            }}
          >
            <span className="line-clamp-3 break-words">{t.title}</span>
            <span className="num font-bold whitespace-nowrap text-state-pending-text">
              {cs.log.points(t.score)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** "Zapsat úkol?": sends the chore at the score shown; closes only when it was logged. */
export function LogConfirm({ tile, onClose }: { tile: LogTile | null; onClose: () => void }) {
  const { busy, run } = useTaskAction()
  // A double tap must log once: the busy flag only disables the button after a re-render.
  const sending = useRef(false)
  return (
    <Dialog
      open={tile !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {tile && (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{cs.log.confirmTitle}</DialogTitle>
            <DialogDescription>{cs.log.confirmBody(tile.title, tile.score)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{cs.work.back}</Button>
            </DialogClose>
            <Button
              variant="primary"
              disabled={busy !== null}
              onClick={(e) => {
                if (sending.current) return
                sending.current = true
                void run(
                  `log-${String(tile.id)}`,
                  () => selfLogFn({ data: { templateId: tile.id, score: tile.score } }),
                  () => cs.log.toast,
                  { confetti: e.currentTarget, float: tile.score },
                ).then((logged) => {
                  sending.current = false
                  if (logged) onClose()
                })
              }}
            >
              {cs.log.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
