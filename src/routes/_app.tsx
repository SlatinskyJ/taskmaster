import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { getCurrentUserFn } from '~/server/auth/functions'

// Every screen behind login lives under this pathless layout (spec §6). Nobody signed in →
// login screen, coming back here afterwards. Children get `context.user`.
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUserFn()
    if (!user) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
    return { user }
  },
  component: Outlet,
})
