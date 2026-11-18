import { cn } from '~/lib/utils'

/** Coral circle with the first letter of the name (UI doc §2.1 accent: avatars). */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-full bg-accent-strong font-display text-lg font-bold text-on-accent-strong',
        className,
      )}
    >
      {name.trim().charAt(0).toLocaleUpperCase('cs') || '?'}
    </span>
  )
}
