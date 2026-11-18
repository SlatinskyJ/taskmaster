import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { safeRedirect } from '~/lib/redirect'
import { cs } from '~/lib/strings'
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

// Password form (UI doc §7.4). #29 puts the passkey button first, above it.
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
    <main className="mx-auto grid min-h-dvh max-w-sm content-center gap-6 px-gutter py-10">
      <div className="grid justify-items-center gap-1 text-center">
        <span className="font-display text-4xl font-bold text-accent-strong">{cs.app.name}</span>
        <h1 className="text-xl font-semibold text-muted">{cs.login.title}</h1>
      </div>
      <Card>
        {/* #29: passkey button ("Přihlásit otiskem / obličejem") goes here, before the form. */}
        <form
          method="post"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit(new FormData(e.currentTarget))
          }}
        >
          <label className="grid gap-1.5 font-semibold">
            {cs.login.username}
            <Input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              required
              aria-invalid={error !== null}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </label>
          <label className="grid gap-1.5 font-semibold">
            {cs.login.password}
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={error !== null}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </label>
          {error && (
            <p id="login-error" role="alert" className="font-semibold text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy}>
            {cs.login.submit}
          </Button>
        </form>
      </Card>
    </main>
  )
}
