import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { safeRedirect } from '~/lib/redirect'
import { cs } from '~/lib/strings'
import { landingPath } from '~/server/auth/authorize'
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
    const result = await loginFn({
      data: { username: field('username'), password: field('password') },
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error === 'rate_limited' ? cs.login.rateLimited : cs.login.invalid)
      return
    }
    await router.invalidate()
    await router.navigate({ href: search.redirect ?? landingPath(result.user.role) })
  }

  return (
    <main className="mx-auto grid max-w-xs gap-4 p-4 pt-16">
      <h1 className="text-3xl font-bold">{cs.login.title}</h1>
      <form
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
            className="rounded border p-2"
          />
        </label>
        <label className="grid gap-1">
          {cs.login.password}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="rounded border p-2"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="rounded border p-2 font-semibold">
          {cs.login.submit}
        </button>
      </form>
    </main>
  )
}
