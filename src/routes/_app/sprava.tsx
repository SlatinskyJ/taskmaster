import { createFileRoute, redirect } from '@tanstack/react-router'
import { LogoutButton } from '~/components/LogoutButton'
import { cs } from '~/lib/strings'
import { landingPath } from '~/server/auth/authorize'
import { listUsersFn } from '~/server/users/functions'

// Správa, the admin's only screen (UI doc §6, §7.5). Others go back to their landing.
export const Route = createFileRoute('/_app/sprava')({
  beforeLoad: ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's redirect
    if (context.user.role !== 'admin') throw redirect({ to: landingPath(context.user.role) })
  },
  loader: () => listUsersFn(),
  component: Sprava,
})

// Placeholder until the admin console (#47).
function Sprava() {
  const people = Route.useLoaderData()
  return (
    <main className="mx-auto grid max-w-md gap-4 p-4">
      <h1 className="text-3xl font-bold">{cs.admin.title}</h1>
      <h2 className="text-xl font-semibold">{cs.admin.people}</h2>
      <ul className="grid gap-1">
        {people.map((p) => (
          <li key={p.id}>
            {p.displayName} · {cs.roles[p.role]}
          </li>
        ))}
      </ul>
      <LogoutButton />
    </main>
  )
}
