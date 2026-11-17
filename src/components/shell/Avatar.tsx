import { cn } from '~/lib/utils'

// Round initial in a colour of its own per person (UI doc §2.1: avatars). Only state *text*
// tokens: they are dark in light mode and light in dark mode, the initial uses the page
// background (the opposite), and src/styles/theme.test.ts checks every state text token
// against that background at 4.5:1 in both themes.
const AVATAR_COLOURS = [
  'bg-state-open-text',
  'bg-state-proposed-text',
  'bg-state-confirmed-text',
  'bg-state-reserved-text',
  'bg-state-negotiating-text',
] as const

export function avatarColour(userId: number): string {
  const i = Math.abs(Math.trunc(userId)) % AVATAR_COLOURS.length
  return AVATAR_COLOURS[i] ?? AVATAR_COLOURS[0]
}

export function initial(name: string): string {
  return (name.trim()[0] ?? '?').toLocaleUpperCase('cs')
}

export function Avatar({
  userId,
  name,
  size = 'md',
  className,
}: {
  userId: number
  name: string
  size?: 'md' | 'lg'
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-display font-bold text-bg',
        size === 'lg' ? 'size-14 text-2xl' : 'size-tap text-lg',
        avatarColour(userId),
        className,
      )}
    >
      {initial(name)}
    </span>
  )
}
