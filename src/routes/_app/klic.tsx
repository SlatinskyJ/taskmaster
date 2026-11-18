import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { Fingerprint } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { landingPath } from '~/lib/landing'
import { addPasskey } from '~/lib/passkeys'
import { safeRedirect } from '~/lib/redirect'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { getPasskeysEnabledFn } from '~/server/passkeys/functions'

interface OfferSearch {
  /** Where login was heading (see `safeRedirect`). */
  redirect?: string
}

// The passkey offer (UI doc §7.4 "Passkey"): shown once after a password login when this
// device could log in with Face ID / a fingerprint and the user has none yet. "Teď ne" stores
// nothing, so the next password login asks again (Jakub, 2026-11-18). Full screen, no bar.
export const Route = createFileRoute('/_app/klic')({
  validateSearch: (search: Record<string, unknown>): OfferSearch => {
    const target = safeRedirect(search.redirect)
    return target ? { redirect: target } : {}
  },
  beforeLoad: async ({ context, search }) => {
    guardScreen(context.user.role, '/klic')
    if (!(await getPasskeysEnabledFn())) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
      throw redirect({ href: search.redirect ?? landingPath(context.user.role) })
    }
  },
  component: Offer,
})

function Offer() {
  const { user } = Route.useRouteContext()
  const search = Route.useSearch()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = search.redirect ?? landingPath(user.role)

  async function goOn() {
    await router.navigate({ href: target })
  }

  async function set() {
    setBusy(true)
    setError(null)
    try {
      const outcome = await addPasskey()
      if (outcome.ok || outcome.reason === 'already') {
        toast.success(outcome.ok ? cs.passkeys.added : cs.passkeys.already)
        await goOn()
      } else if (outcome.reason === 'failed') {
        setError(cs.login.failed)
      }
    } finally {
      // Every outcome gives the buttons back: a cancelled sheet must not leave a dead screen.
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center gap-5 px-5 pt-20 pb-7 text-center">
      <span className="grid size-20 place-items-center rounded-full bg-accent/20 text-accent-strong">
        <Fingerprint aria-hidden="true" className="size-10" />
      </span>
      <h1 className="font-display text-title leading-tight font-bold text-balance">
        {cs.passkeys.offerTitle}
      </h1>
      <p className="font-bold text-muted">{cs.passkeys.offerText}</p>
      {error && (
        <p role="alert" className="font-bold text-state-rejected-text">
          {error}
        </p>
      )}
      <div className="mt-auto grid w-full gap-3">
        <Button size="lg" disabled={busy} onClick={() => void set()} className="w-full">
          {cs.passkeys.offerSet}
        </Button>
        <Button
          variant="ghost"
          size="lg"
          disabled={busy}
          onClick={() => void goOn()}
          className="w-full"
        >
          {cs.passkeys.offerLater}
        </Button>
      </div>
    </main>
  )
}
