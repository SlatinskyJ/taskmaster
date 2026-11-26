import { Link, useRouter } from '@tanstack/react-router'
import type { MouseEvent } from 'react'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { buttonVariants } from '~/components/ui/button'
import type { StaticAppPath } from '~/lib/nav'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { Avatar } from './Avatar'

/**
 * One screen inside the shell: the title and the avatar that opens Profile (UI doc §6), then
 * the content. Gutter 16 px, designed at 390 px and works from 360 px (UI doc §2.3).
 * `back` adds a back button before the title (sub-screens such as Nový úkol); `action` sits
 * next to the avatar (e.g. "+ Nový"). `back="history"` (a task or chore page, #205) goes back
 * to where the person came from in the app, else to Domů. `fullTitle` (a task or chore page,
 * #264) wraps the whole name; elsewhere the title is cut at two lines. `wide` (the plan table,
 * #258) lets a phone turned sideways use its whole width, so a week's days fit.
 */

/** The history back arrow: back within the app if it can, else the link's own `/`. */
export function historyBack(history: { canGoBack: () => boolean; back: () => void }) {
  return (e: Pick<MouseEvent, 'preventDefault'>) => {
    if (!history.canGoBack()) return
    e.preventDefault()
    history.back()
  }
}

export function Screen({
  title,
  user,
  back,
  action,
  fullTitle = false,
  wide = false,
  children,
}: {
  title: ReactNode
  user: { id: number; displayName: string }
  back?: StaticAppPath | 'history'
  action?: ReactNode
  fullTitle?: boolean
  wide?: boolean
  children: ReactNode
}) {
  const router = useRouter()
  return (
    <div className={cn('mx-auto grid w-full max-w-md gap-3.5', wide && 'landscape:max-w-3xl')}>
      <header className="flex items-center gap-2.5 px-4 pt-5 pb-2">
        {back && (
          <Link
            to={back === 'history' ? '/' : back}
            onClick={back === 'history' ? historyBack(router.history) : undefined}
            aria-label={cs.profile.back}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <ChevronLeft aria-hidden="true" />
          </Link>
        )}
        {/* A long title wraps to two lines, then is cut (#34); a task or chore page shows its
            name in full, as it is said nowhere else on the page (#264). */}
        <h1
          className={cn(
            'min-w-0 flex-1 font-display text-title leading-tight font-bold break-words',
            !fullTitle && 'line-clamp-2',
          )}
        >
          {title}
        </h1>
        {action}
        <Link to="/profil" aria-label={cs.profile.open} className="rounded-full">
          <Avatar userId={user.id} name={user.displayName} />
        </Link>
      </header>
      <main className="grid gap-3.5 px-4 pb-5">{children}</main>
    </div>
  )
}
