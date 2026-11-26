import { cn } from '~/lib/utils'

/**
 * A row that is one on/off switch (Profil's Efekty, Správa's Funkce). The whole row is the
 * switch, so the tap target is the row, not just the knob. Put it in a `Card className="p-0"`.
 */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onToggle,
  disabled,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      disabled={disabled}
      onClick={onToggle}
      className="flex min-h-tap w-full cursor-pointer items-center gap-3 rounded-card p-card text-left disabled:cursor-default disabled:opacity-60"
    >
      <span className="grid min-w-0 flex-1">
        <b id={`${id}-label`} className="text-row font-extrabold break-words">
          {label}
        </b>
        <span id={`${id}-hint`} className="text-meta font-bold break-words text-muted">
          {hint}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative h-8 w-13 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
          checked ? 'bg-ok' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] size-[26px] rounded-full bg-surface shadow-sticker transition-[left] motion-reduce:transition-none',
            checked ? 'left-[23px]' : 'left-[3px]',
          )}
        />
      </span>
    </button>
  )
}
