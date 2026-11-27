import { RefreshCw, X } from 'lucide-react'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'

// The live change banner's markup (#299, design "The banner"), rendered by Sonner as a custom
// toast (src/components/live/LiveBanner.tsx). The look of the app's other toasts comes from the
// Toaster's toast classes (src/components/ui/sonner.tsx). What wraps: the sentence, on as many
// lines as it needs. What is cut: nothing. What stays whole: both buttons, top-aligned.

export const LIVE_TOAST_ID = 'live-changes'

const iconButton =
  'grid size-tap shrink-0 cursor-pointer place-items-center rounded-full text-bg disabled:cursor-default disabled:opacity-60'

export function LiveToast({
  text,
  busy,
  onRefresh,
  onClose,
}: {
  text: string
  busy: boolean
  onRefresh: () => void
  onClose: () => void
}) {
  return (
    <div className="flex w-full items-start gap-1 rounded-card bg-ink py-1 pr-1 pl-4 font-display text-bg select-none">
      <p
        data-live-text
        className="min-w-0 flex-1 py-2.5 text-[15px] leading-snug font-semibold break-words"
      >
        {text}
      </p>
      <button
        type="button"
        aria-label={cs.live.banner.refresh}
        disabled={busy}
        onClick={onRefresh}
        className={iconButton}
      >
        <RefreshCw aria-hidden className={cn('size-5', busy && 'motion-safe:animate-spin')} />
      </button>
      <button
        type="button"
        aria-label={cs.live.banner.close}
        onClick={onClose}
        className={iconButton}
      >
        <X aria-hidden className="size-5" />
      </button>
    </div>
  )
}
