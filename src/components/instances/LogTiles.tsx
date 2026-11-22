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
import type { LogWhen } from '~/domain/logTime'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { selfLogFn } from '~/server/instances/functions'

// Zapsat (#38, UI doc §7.1 TLog): a brother logs a chore he did unprompted. A tile per agreed
// template; a tap asks first (he cannot take a log back, UI doc §5), then it arrives done and
// waits for a parent (spec §5.3).

export interface LogTile {
  id: number
  title: string
  score: number
  /** A copy is on the board, open or reserved: he takes that one instead (Jakub 2026-11-22). */
  onBoard: boolean
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
            aria-label={
              t.onBoard ? cs.log.tileOnBoardLabel(t.title) : cs.log.tileLabel(t.title, t.score)
            }
            disabled={t.onBoard}
            className="h-full min-h-tap flex-col items-start justify-between py-3 text-left whitespace-normal"
            onClick={() => {
              if (!t.onBoard) onPick(t)
            }}
          >
            <span className="line-clamp-3 break-words">{t.title}</span>
            {t.onBoard ? (
              <span className="text-meta text-muted">{cs.log.onBoard}</span>
            ) : (
              <span className="num font-bold whitespace-nowrap text-state-pending-text">
                {cs.log.points(t.score)}
              </span>
            )}
          </Button>
        </li>
      ))}
    </ul>
  )
}

/**
 * "Zapsat úkol?": sends the chore at the score shown and the picked "Kdy?"; closes only when it
 * was logged. The pills show only the choices the server offers (never before this week).
 */
export function LogConfirm({
  tile,
  when,
  choices,
  onWhen,
  onClose,
}: {
  tile: LogTile | null
  when: LogWhen
  choices: readonly LogWhen[]
  onWhen: (when: LogWhen) => void
  onClose: () => void
}) {
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
          {choices.length > 1 && (
            <div role="group" aria-labelledby="log-when" className="grid gap-2">
              <span id="log-when" className="font-extrabold">
                {cs.log.when.label}
              </span>
              <div className="grid grid-cols-3 gap-2">
                {choices.map((w) => (
                  <Button
                    key={w}
                    variant="ghost"
                    aria-pressed={w === when}
                    className={cn(
                      'min-h-tap px-2',
                      w === when ? 'bg-accent/10 ring-3 ring-accent-strong' : 'ring-2 ring-track',
                    )}
                    onClick={() => {
                      onWhen(w)
                    }}
                  >
                    {cs.log.when[w]}
                  </Button>
                ))}
              </div>
            </div>
          )}
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
                  () => selfLogFn({ data: { templateId: tile.id, score: tile.score, when } }),
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
