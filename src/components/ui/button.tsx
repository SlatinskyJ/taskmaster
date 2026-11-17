import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

// UI doc §5: primary (coral), ok (green), no (white, red outline), ghost (white, outline),
// icon 44 px. Every size keeps the 44 px tap target (UI doc §1).
export const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-button font-display font-semibold whitespace-nowrap transition-[transform,background-color,box-shadow] select-none active:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-5',
  {
    variants: {
      variant: {
        primary: 'bg-accent-strong text-on-accent-strong shadow-sticker',
        ok: 'bg-ok text-on-ok shadow-sticker',
        no: 'border-2 border-state-rejected bg-surface text-state-rejected-text shadow-sticker',
        ghost: 'border-2 border-track bg-surface text-ink shadow-sticker',
      },
      size: {
        default: 'min-h-tap px-4 text-row',
        lg: 'min-h-12 px-5 text-[17px]',
        icon: 'size-tap',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
