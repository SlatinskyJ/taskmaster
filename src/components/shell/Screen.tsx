import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { buttonVariants } from '~/components/ui/button'
import type { AppPath } from '~/lib/nav'
import { cs } from '~/lib/strings'
import { Avatar } from './Avatar'

/**
 * One screen inside the shell: the title and the avatar that opens Profile (UI doc §6), then
 * the content. Gutter 16 px, designed at 390 px and works from 360 px (UI doc §2.3).
 * `back` adds a back button before the title (sub-screens such as Nový úkol); `action` sits
 * next to the avatar (e.g. "+ Nový").
 */
export function Screen({
  title,
  user,
  back,
  action,
  children,
}: {
  title: ReactNode
  user: { id: number; displayName: string }
  back?: AppPath
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="mx-auto grid w-full max-w-md gap-3.5">
      <header className="flex items-center gap-2.5 px-4 pt-5 pb-2">
        {back && (
          <Link
            to={back}
            aria-label={cs.profile.back}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <ChevronLeft aria-hidden="true" />
          </Link>
        )}
        <h1 className="min-w-0 flex-1 font-display text-title leading-tight font-bold">{title}</h1>
        {action}
        <Link to="/profil" aria-label={cs.profile.open} className="rounded-full">
          <Avatar userId={user.id} name={user.displayName} />
        </Link>
      </header>
      <main className="grid gap-3.5 px-4 pb-5">{children}</main>
    </div>
  )
}
