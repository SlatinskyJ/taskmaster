import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { safeRedirect } from '~/lib/redirect'
import { cs } from '~/lib/strings'
import { cn } from '~/lib/utils'
import { landingPath } from '~/lib/landing'
import { getCurrentUserFn, loginFn } from '~/server/auth/functions'

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
  component: Login,
})

// Password login (UI doc §7.4). #29 adds the passkey button above the form.
/** The five Pastelky dots above the name (login mockup). */
const LOGO_DOTS = [
  'bg-accent',
  'bg-state-pending',
  'bg-state-confirmed',
  'bg-state-open',
  'bg-accent2',
] as const

const LABEL_TEXT = 'text-xs font-extrabold tracking-[.07em] text-muted uppercase'

function Login() {
  const search = Route.useSearch()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      await router.invalidate()
      await router.navigate({ href: search.redirect ?? landingPath(result.user.role) })
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
      {/* The passkey button (#29) goes here, above the password form (UI doc §7.4). */}
      <form
        method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(new FormData(e.currentTarget))
        }}
      >
        <label className="grid gap-2">
          <span className={LABEL_TEXT}>{cs.login.username}</span>
          <Input
            name="username"
            autoComplete="username"
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
          <span className={LABEL_TEXT}>{cs.login.password}</span>
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
