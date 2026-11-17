import { useRouter } from '@tanstack/react-router'
import { cs } from '~/lib/strings'
import { logoutFn } from '~/server/auth/functions'

// Bare logout until the profile screen (#31) takes it over.
export function LogoutButton() {
  const router = useRouter()
  return (
    <button
      type="button"
      className="min-h-11 px-3 underline"
      onClick={() => {
        void logoutFn().then(() => router.navigate({ to: '/login' }))
      }}
    >
      {cs.login.logout}
    </button>
  )
}
