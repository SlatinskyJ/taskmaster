import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { cs } from '~/lib/strings'
import { Avatar } from './Avatar'

/**
 * One screen inside the shell: the title and the avatar that opens Profile (UI doc §6), then
 * the content. Gutter 16 px, designed at 390 px and works from 360 px (UI doc §2.3).
 */
export function Screen({
  title,
  user,
  children,
}: {
  title: ReactNode
  user: { id: number; displayName: string }
  children: ReactNode
}) {
  return (
    <div className="mx-auto grid w-full max-w-md gap-3.5">
      <header className="flex items-center justify-between gap-3 px-4 pt-5 pb-2">
        <h1 className="font-display text-title leading-tight font-bold">{title}</h1>
        <Link to="/profil" aria-label={cs.profile.open} className="rounded-full">
          <Avatar userId={user.id} name={user.displayName} />
        </Link>
      </header>
      <main className="grid gap-3.5 px-4 pb-5">{children}</main>
    </div>
  )
}
