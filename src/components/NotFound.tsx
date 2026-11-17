import { Link } from '@tanstack/react-router'
import { cs } from '~/lib/strings'

export function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center gap-4 p-4">
      <p>{cs.notFound.message}</p>
      <Link to="/" className="underline">
        {cs.nav.home}
      </Link>
    </main>
  )
}
