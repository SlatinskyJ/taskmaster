import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'
import { keepOpenForToaster } from './outside'

// UI doc §5: only for actions that can't be undone (cancel task, settle).
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

/**
 * Centred in the part of the screen a person can see, which the phone keyboard shrinks (#215).
 * `--vv-top` / `--vv-height` come from trackVisualViewport (src/lib/visualViewport.ts); the
 * fallbacks are the whole screen. Taller than that part, the dialog scrolls inside.
 */
export const dialogPlacement =
  'top-[calc(var(--vv-top,0px)+var(--vv-height,100dvh)/2)] max-h-[calc(var(--vv-height,100dvh)-2rem)] overflow-y-auto'

export function DialogContent({
  className,
  children,
  closeLabel,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  /** Czech label for the corner close button (from the strings module); no button without it. */
  closeLabel?: string
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/45 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          dialogPlacement,
          'fixed left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-1/2 gap-4 rounded-card bg-surface p-5 text-ink shadow-sticker data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none',
          className,
        )}
        {...props}
        // A tap on the live change banner keeps the dialog open (#299, ./outside.ts).
        onPointerDownOutside={keepOpenForToaster(onPointerDownOutside)}
        onInteractOutside={keepOpenForToaster(onInteractOutside)}
      >
        {children}
        {closeLabel ? (
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="absolute top-1 right-1 grid size-tap cursor-pointer place-items-center rounded-full text-muted"
          >
            <XIcon className="size-5" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('grid gap-1.5', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-footer" className={cn('grid grid-cols-2 gap-3', className)} {...props} />
  )
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-display text-xl font-semibold', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted', className)}
      {...props}
    />
  )
}
