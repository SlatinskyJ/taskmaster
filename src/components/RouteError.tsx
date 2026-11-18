import { useRouter } from '@tanstack/react-router'
import { Button } from '~/components/ui/button'
import { cs } from '~/lib/strings'

/**
 * Shown in place of a screen whose loader failed (e.g. the server is unreachable). Czech, with
 * a retry that re-runs the loaders. The router's default for every route (src/router.tsx).
 */
export function RouteError() {
  const router = useRouter()
  return (
    <div role="alert" className="mx-auto grid w-full max-w-md gap-3.5 px-4 pt-10 text-center">
      <p className="font-display text-title leading-tight font-bold">{cs.routeError.title}</p>
      <p className="font-bold text-muted">{cs.routeError.message}</p>
      <Button
        size="lg"
        className="w-full"
        onClick={() => {
          void router.invalidate()
        }}
      >
        {cs.routeError.retry}
      </Button>
    </div>
  )
}
