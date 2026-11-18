import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PasskeyLoginButton } from '~/components/auth/PasskeyLoginButton'
import { sectionLabelClass } from '~/components/shell/SectionLabel'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { safeRedirect } from '~/lib/redirect'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { landingPath } from '~/lib/landing'
import {
  autofillUsable,
  createLoginFlow,
  loginWithPasskey,
  passkeysUsable,
  type PasskeyLoginOutcome,
} from '~/lib/passkeys'
import { getCurrentUserFn, loginFn } from '~/server/auth/functions'
import { getPasskeysEnabledFn, listMyPasskeysFn } from '~/server/passkeys/functions'

interface LoginSearch {
  /** Where to go after login: a path inside the app (see `safeRedirect`). */
  redirect?: string
}

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const target = safeRedirect(search.redirect)
    return target ? { redirect: target } : {}
  },
  beforeLoad: async () => {
    const user = await getCurrentUserFn()
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    if (user) throw redirect({ to: landingPath(user.role) })
  },
  loader: async () => ({ passkeys: await getPasskeysEnabledFn() }),
  component: Login,
})

// Login (UI doc §7.4): the passkey button first when this deployment has passkeys (#29),
// password as the fallback. Passkeys also wait in the name field's autofill.
/** The five Pastelky dots above the name (login mockup). */
const LOGO_DOTS = [
  'bg-accent',
  'bg-state-pending',
  'bg-state-confirmed',
  'bg-state-open',
  'bg-accent2',
] as const

function Login() {
  const search = Route.useSearch()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { passkeys } = Route.useLoaderData()
  // Decided after mount: the server render has no WebAuthn to ask.
  const [canPasskey, setCanPasskey] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const flow = useRef<ReturnType<typeof createLoginFlow> | null>(null)

  /** After a password login: offer a passkey when this device can use one and none exists. */
  async function offerPasskey(): Promise<boolean> {
    if (!canPasskey) return false
    try {
      return (await listMyPasskeysFn()).length === 0
    } catch {
      return false
    }
  }

  async function finish(user: { role: Parameters<typeof landingPath>[0] }, offer = false) {
    const target = search.redirect ?? landingPath(user.role)
    await router.invalidate()
    if (offer) await router.navigate({ to: '/klic', search: { redirect: target } })
    else await router.navigate({ href: target })
  }

  function onPasskey(outcome: PasskeyLoginOutcome) {
    if (outcome.ok) {
      void finish(outcome.user)
      return
    }
    const messages: Record<typeof outcome.reason, string | null> = {
      cancelled: null,
      unknown: cs.passkeys.unknown,
      rate_limited: cs.login.rateLimited,
      busy: cs.login.failed,
      failed: cs.login.failed,
    }
    setError(messages[outcome.reason])
  }

  useEffect(() => {
    if (!passkeys || !passkeysUsable() || flow.current) return
    setCanPasskey(true)
    const f = createLoginFlow({
      login: loginWithPasskey,
      onDone: (o) => {
        onPasskey(o)
      },
    })
    flow.current = f
    void autofillUsable().then((yes) => {
      if (yes) f.startAutofill()
    })
    // onPasskey only reads state setters and the router; one flow per mounted screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passkeys])

  async function passkeyClick() {
    if (!flow.current) return
    setPasskeyBusy(true)
    setError(null)
    try {
      await flow.current.clickButton()
    } finally {
      setPasskeyBusy(false)
    }
  }

  async function submit(form: FormData) {
    const field = (name: string) => {
      const value = form.get(name)
      return typeof value === 'string' ? value : ''
    }
    setBusy(true)
    setError(null)
    try {
      const result = await loginFn({
        data: { username: field('username'), password: field('password') },
      })
      if (!result.ok) {
        setError(result.error === 'rate_limited' ? cs.login.rateLimited : cs.login.invalid)
        return
      }
      await finish(result.user, await offerPasskey())
    } catch {
      // Network down or server error: say so and let them try again.
      setError(cs.login.failed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col gap-6 px-5 pt-14 pb-7">
      <div className="flex flex-col items-center gap-2.5">
        <div aria-hidden="true" className="flex gap-1.5">
          {LOGO_DOTS.map((dot) => (
            <span key={dot} className={cn('size-3.5 rounded-full', dot)} />
          ))}
        </div>
        <span className="font-display text-[40px] leading-none font-bold">{cs.app.name}</span>
        <span className="text-meta font-bold text-muted">{cs.app.tagline}</span>
      </div>
      <h1 className="sr-only">{cs.login.title}</h1>
      {canPasskey && (
        <>
          <PasskeyLoginButton busy={passkeyBusy} onClick={() => void passkeyClick()} />
          <div
            aria-hidden="true"
            className="flex items-center gap-3 text-meta font-bold text-muted"
          >
            <span className="h-px flex-1 bg-track" />
            {cs.passkeys.or}
            <span className="h-px flex-1 bg-track" />
          </div>
        </>
      )}
      <form
        method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(new FormData(e.currentTarget))
        }}
      >
        <label className="grid gap-2">
          <span className={sectionLabelClass}>{cs.login.username}</span>
          <Input
            name="username"
            autoComplete={canPasskey ? 'username webauthn' : 'username'}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            aria-invalid={error !== null}
            aria-describedby={error ? 'login-error' : undefined}
            className="min-h-13 text-lg font-bold"
          />
        </label>
        <label className="grid gap-2">
          <span className={sectionLabelClass}>{cs.login.password}</span>
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={error !== null}
            aria-describedby={error ? 'login-error' : undefined}
            className="min-h-13 text-lg font-bold"
          />
        </label>
        {error && (
          <p id="login-error" role="alert" className="font-bold text-state-rejected-text">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {cs.login.submit}
        </Button>
      </form>
      <p className="mt-auto text-center text-meta font-bold text-muted">{cs.login.help}</p>
    </main>
  )
}
