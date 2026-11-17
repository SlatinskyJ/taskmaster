import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

// UI doc §2.3: radius 16, padding 14, flat 2 px sticker shadow.
export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-card bg-surface p-card text-ink shadow-sticker', className)}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('mb-2 grid gap-1', className)} {...props} />
}

export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('font-display text-[17px] font-semibold', className)}
      {...props}
    />
  )
}

export function CardDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-meta text-muted', className)}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('grid gap-3', className)} {...props} />
}
