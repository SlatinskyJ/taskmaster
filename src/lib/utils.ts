import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Our font sizes (theme.css) must be known here, or `text-row` would be taken for a colour
// and silently drop a `text-ink` next to it. Same for radius, shadow, font and spacing names.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['title', 'row', 'meta', 'chip', 'points'],
      radius: ['card', 'button'],
      shadow: ['sticker'],
      font: ['display', 'body'],
      spacing: ['tap', 'card', 'gutter'],
    },
  },
})

/** Joins class names; later Tailwind classes win over earlier ones (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
