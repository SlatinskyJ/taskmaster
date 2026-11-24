import { adminDisputeLines } from '~/components/disputes/disputeProps'
import { levelLabel, weekLabel } from '~/components/period/periodView'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Textarea } from '~/components/ui/textarea'
import type { Level } from '~/domain'
import { ADJUST_POINTS_MAX, FIX_REASON_MAX } from '~/lib/disputeLimits'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import type { FixTaker, FixWeek } from '~/server/corrections/functions'
import { belowZero, fixRequest, pointsPreview, sendLabel, weekDifference, weekOf } from './fixDraft'
import type { FixDraft, FixStart } from './fixDraft'

// The fix sheet's body (#48, UI doc §7.5 AFix): who, how many points or which week and level,
// what it does to his points, the reason the family reads. No hooks, so each state renders in
// a test; FixDrawer holds the draft.

const t = cs.admin.fix
const LEVELS: readonly Level[] = ['none', 'lower', 'upper']

function Pill({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={pressed}
      disabled={disabled}
      className={cn(
        'h-auto min-h-tap max-w-full justify-start px-3 py-2 text-left break-words whitespace-normal',
        pressed ? 'bg-accent/10 ring-3 ring-accent-strong' : 'ring-2 ring-track',
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function weekLine(w: FixWeek): string {
  const c = cs.week
  return `${c.total} ${String(w.totalBefore)} · ${c.deducted} ${String(w.deducted)} · ${c.carry} ${String(w.carryOver)}`
}

export interface FixFormProps {
  start: FixStart
  fixable: readonly FixTaker[]
  draft: FixDraft
  busy: boolean
  error: string | null
  onChange: (draft: FixDraft) => void
  onSend: () => void
}

export function FixForm({ start, fixable, draft, busy, error, onChange, onSend }: FixFormProps) {
  const set = (over: Partial<FixDraft>) => {
    onChange({ ...draft, ...over })
  }
  const request = fixRequest(draft, start, fixable)
  const lines = start.dispute ? adminDisputeLines(start.dispute) : null
  const takerLocked = start.dispute !== null && start.takerId !== null
  const weekLocked = start.mode === 'week' && start.dispute !== null
  const fixed = weekLocked ? weekOf(fixable, draft.settlementId) : undefined
  const taker = fixable.find((p) => p.id === draft.takerId)
  const weeks = fixed ? [fixed.week] : (taker?.weeks ?? [])
  const current = weekOf(fixable, draft.settlementId)?.week
  const preview = draft.mode === 'points' ? pointsPreview(draft, fixable) : null
  const difference = draft.mode === 'week' ? weekDifference(draft, fixable) : null
  return (
    <form
      className="grid min-w-0 gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (request && !busy) onSend()
      }}
    >
      {lines && (
        <div className="grid min-w-0 gap-0.5 rounded-button bg-track/40 px-3 py-2">
          <span className="text-meta font-bold break-words text-muted">{lines.what}</span>
          <span className="font-bold break-words">{lines.value}</span>
          <span className="text-meta break-words text-muted">{lines.opened}</span>
          <span className="break-words">{lines.reason}</span>
        </div>
      )}
      <fieldset className="grid min-w-0 gap-1.5">
        <legend className={cn(sectionLabelClass, 'mb-1.5')}>{t.who}</legend>
        {fixable.length === 0 ? (
          <p className="text-meta text-muted">{t.noTakers}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {fixable.map((p) => (
              <Pill
                key={p.id}
                pressed={p.id === draft.takerId}
                disabled={(takerLocked || weekLocked) && p.id !== draft.takerId}
                onClick={() => {
                  set({ takerId: p.id, settlementId: weekLocked ? draft.settlementId : null })
                }}
              >
                {p.name}
              </Pill>
            ))}
          </div>
        )}
      </fieldset>
      {draft.mode === 'points' ? (
        <div className="grid min-w-0 gap-1.5">
          <div className="flex flex-wrap gap-2">
            <Pill
              pressed={draft.sign > 0}
              onClick={() => {
                set({ sign: 1 })
              }}
            >
              {t.add}
            </Pill>
            <Pill
              pressed={draft.sign < 0}
              onClick={() => {
                set({ sign: -1 })
              }}
            >
              {t.remove}
            </Pill>
          </div>
          <label className="grid gap-1.5">
            <span className={sectionLabelClass}>{t.points}</span>
            <Input
              name="points"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              enterKeyHint="next"
              maxLength={String(ADJUST_POINTS_MAX).length}
              value={draft.amount}
              onChange={(e) => {
                set({ amount: e.target.value.trim() })
              }}
            />
          </label>
          {preview && <p className="num text-meta font-bold break-words">{preview}</p>}
          {belowZero(draft, fixable) && (
            <p className="text-meta font-bold text-state-rejected-text">{t.belowZero}</p>
          )}
        </div>
      ) : (
        <>
          {taker && (
            <fieldset className="grid min-w-0 gap-1.5">
              <legend className={cn(sectionLabelClass, 'mb-1.5')}>{t.week}</legend>
              {weeks.length === 0 ? (
                <p className="text-meta text-muted">{t.noWeeks}</p>
              ) : (
                <div className="grid gap-2">
                  {weeks.map((w) => (
                    <Pill
                      key={w.settlementId}
                      pressed={w.settlementId === draft.settlementId}
                      onClick={() => {
                        set({ settlementId: w.settlementId, level: null })
                      }}
                    >
                      <span className="grid min-w-0 gap-0.5">
                        <span className="font-bold">
                          {weekLabel(w.startsAt, w.endsAt)} · {levelLabel(w.level)}
                          {w.corrected && ` · ${t.corrected}`}
                        </span>
                        <span className="num text-meta text-muted">{weekLine(w)}</span>
                      </span>
                    </Pill>
                  ))}
                </div>
              )}
            </fieldset>
          )}
          {current && (
            <fieldset className="grid min-w-0 gap-1.5">
              <legend className={cn(sectionLabelClass, 'mb-1.5')}>{t.level}</legend>
              <div className="flex flex-wrap gap-2">
                {LEVELS.map((l) => (
                  <Pill
                    key={l}
                    pressed={l === draft.level}
                    disabled={l === current.level}
                    onClick={() => {
                      set({ level: l })
                    }}
                  >
                    {levelLabel(l)}
                  </Pill>
                ))}
              </div>
              {difference !== null && (
                <p className="num text-meta font-bold">{t.difference(difference)}</p>
              )}
            </fieldset>
          )}
        </>
      )}
      <label className="grid gap-1.5">
        <span className={sectionLabelClass}>{t.reason}</span>
        <Textarea
          name="reason"
          required
          maxLength={FIX_REASON_MAX}
          value={draft.reason}
          onChange={(e) => {
            set({ reason: e.target.value })
          }}
        />
      </label>
      <p className="text-meta text-muted">{start.dispute ? t.hintDispute : t.hint}</p>
      {error && (
        <p role="alert" className="text-meta font-bold break-words text-state-rejected-text">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="h-auto min-h-tap py-2 break-words whitespace-normal"
        disabled={request === null || busy}
        aria-busy={busy}
      >
        {busy
          ? t.saving
          : (sendLabel(draft, fixable) ?? (draft.mode === 'points' ? t.adjust : t.correct))}
      </Button>
    </form>
  )
}
