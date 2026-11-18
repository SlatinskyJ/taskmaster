import { createFileRoute } from '@tanstack/react-router'
import { Card } from '~/components/ui/card'
import { guardScreen } from '~/lib/routeGuard'
import { cs } from '~/lib/strings'
import { listUsersFn } from '~/server/users/functions'

// Správa, the admin's only screen (UI doc §6, §7.5). Others go back to their landing.
export const Route = createFileRoute('/_app/sprava')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/sprava')
  },
  loader: () => listUsersFn(),
  component: Sprava,
})

// Placeholder until the admin console (#47).
function Sprava() {
  const people = Route.useLoaderData()
  return (
    <div className="grid gap-4">
      <h1 className="text-title font-bold">{cs.admin.title}</h1>
      <Card className="grid gap-2">
        <h2 className="text-lg font-semibold">{cs.admin.people}</h2>
        <ul className="grid gap-1">
          {people.map((p) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="font-bold">{p.displayName}</span>
              <span className="text-meta text-muted">{cs.roles[p.role]}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
