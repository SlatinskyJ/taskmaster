import { createFileRoute, Link } from '@tanstack/react-router'
import { EmptyState } from '~/components/EmptyState'
import { Screen } from '~/components/shell/Screen'
import { TaskRow } from '~/components/tasks/TaskRow'
import { buttonVariants } from '~/components/ui/button'
import { guardScreen } from '~/lib/screenGuard'
import { cs, type ItemStateKey } from '~/lib/strings'
import { listTasksFn, type TaskView } from '~/server/tasks/functions'

// Úkoly: all one-time tasks by state, givers only (UI doc §7.2 GTasks). Recurring templates
// join with #37.
export const Route = createFileRoute('/_app/ukoly/')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/ukoly')
  },
  loader: () => listTasksFn(),
  component: Tasks,
})

/** Lifecycle status (spec §5.6) → the chip's state (UI doc §2.2). */
const STATE: Record<TaskView['status'], ItemStateKey> = {
  proposed: 'proposed',
  open: 'open',
  reserved: 'reserved',
  done_unconfirmed: 'pending',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
}

function Tasks() {
  const { user } = Route.useRouteContext()
  const list = Route.useLoaderData()
  const newButton = (
    <Link to="/ukoly/novy" className={buttonVariants({ variant: 'primary' })}>
      {cs.tasks.new}
    </Link>
  )
  return (
    <Screen title={cs.nav.tasks} user={user} action={newButton}>
      {list.length === 0 ? (
        <EmptyState>{cs.tasks.empty}</EmptyState>
      ) : (
        <ul className="grid gap-2">
          {list.map((t) => (
            <li key={t.id}>
              <TaskRow
                name={t.title}
                state={STATE[t.status]}
                points={t.score}
                meta={t.status === 'proposed' ? cs.tasks.waitingForTaker : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </Screen>
  )
}
