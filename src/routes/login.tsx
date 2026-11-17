import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
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

// Bare password form; the app shell (#31) styles it and #29 adds the passkey button.
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
    <main className="mx-auto grid max-w-xs gap-4 p-4 pt-16">
      <h1 className="text-3xl font-bold">{cs.login.title}</h1>
      <form
        method="post"
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(new FormData(e.currentTarget))
        }}
      >
        <label className="grid gap-1">
          {cs.login.username}
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            required
            aria-invalid={error !== null}
            aria-describedby={error ? 'login-error' : undefined}
            className="rounded border p-3"
          />
        </label>
        <label className="grid gap-1">
          {cs.login.password}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={error !== null}
            aria-describedby={error ? 'login-error' : undefined}
            className="rounded border p-3"
          />
        </label>
        {error && (
          <p id="login-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy} className="rounded border p-3 font-semibold">
          {cs.login.submit}
        </button>
      </form>
    </main>
  )
}
