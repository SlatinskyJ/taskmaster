import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { TakerBoard } from '~/components/tasks/TakerBoard'
import { ToApprove } from '~/components/tasks/ToApprove'
import { WaitingForYou } from '~/components/tasks/WaitingForYou'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import {
  listBoardFn,
  listPendingApprovalsFn,
  listPendingCompletionsFn,
} from '~/server/tasks/functions'
import { listPendingTemplateApprovalsFn } from '~/server/templates/functions'

// Domů for takers and givers (UI doc §6). The admin has no Domů and lands on Správa.
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/')
  },
  loader: async ({ context }) => {
    const waiting = await listPendingApprovalsFn()
    const waitingTemplates = await listPendingTemplateApprovalsFn()
    if (context.user.role === 'taker') {
      return { waiting, waitingTemplates, board: await listBoardFn(), toApprove: [] }
    }
    return { waiting, waitingTemplates, board: [], toApprove: await listPendingCompletionsFn() }
  },
  component: Home,
})

// "Čeká na tebe" first, then the work lists; the rest of the home screens comes with #40, #41.
function Home() {
  const { user } = Route.useRouteContext()
  const { waiting, waitingTemplates, board, toApprove } = Route.useLoaderData()
  return (
    <Screen title={`${cs.home.greeting}, ${user.displayName}!`} user={user}>
      <WaitingForYou items={waiting} templates={waitingTemplates} />
      {user.role === 'taker' ? (
        <TakerBoard items={board} me={user.id} />
      ) : (
        <ToApprove items={toApprove} />
      )}
      <Placeholder />
    </Screen>
  )
}
