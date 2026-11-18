import { createFileRoute } from '@tanstack/react-router'
import { Avatar } from '~/components/shell/Avatar'
import { Screen } from '~/components/shell/Screen'
import { SectionLabel } from '~/components/shell/SectionLabel'
import { Card } from '~/components/ui/card'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { listUsersFn } from '~/server/users/functions'

// Správa, the admin's only screen, no bottom bar (UI doc §6, §7.5). Others go to their landing.
export const Route = createFileRoute('/_app/sprava')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/sprava')
  },
  loader: () => listUsersFn(),
  component: Sprava,
})

// People list only, until the admin console (#47).
function Sprava() {
  const { user } = Route.useRouteContext()
  const people = Route.useLoaderData()
  return (
    <Screen title={cs.admin.title} user={user}>
      <SectionLabel>{cs.admin.people}</SectionLabel>
      <Card>
        <ul className="grid gap-1">
          {people.map((p) => (
            <li key={p.id} className="flex min-h-11 items-center gap-2.5">
              <Avatar userId={p.id} name={p.displayName} />
              <b className="font-extrabold">{p.displayName}</b>
              <span className="ml-auto rounded-full bg-track px-2 py-0.5 text-xs font-extrabold text-muted">
                {cs.roles[p.role]}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  )
}
