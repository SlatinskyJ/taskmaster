import { createFileRoute } from '@tanstack/react-router'
import { Placeholder } from '~/components/shell/Placeholder'
import { Screen } from '~/components/shell/Screen'
import { BidsToAnswer } from '~/components/tasks/BidsToAnswer'
import { TakerBoard } from '~/components/tasks/TakerBoard'
import { RecurringList } from '~/components/templates/RecurringList'
import { ToApprove } from '~/components/tasks/ToApprove'
import { WaitingForYou } from '~/components/tasks/WaitingForYou'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import {
  listBidsToAnswerFn,
  listBoardFn,
  listPendingApprovalsFn,
  listPendingCompletionsFn,
} from '~/server/tasks/functions'
import {
  listPendingTemplateApprovalsFn,
  listPendingTemplatePriceChangesFn,
  listTemplatesFn,
} from '~/server/templates/functions'

// Domů for takers and givers (UI doc §6). The admin has no Domů and lands on Správa.
export const Route = createFileRoute('/_app/')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/')
  },
  loader: async ({ context }) => {
    const waiting = await listPendingApprovalsFn()
    const waitingTemplates = await listPendingTemplateApprovalsFn()
    const priceChanges = await listPendingTemplatePriceChangesFn()
    if (context.user.role === 'taker') {
      return {
        waiting,
        waitingTemplates,
        priceChanges,
        board: await listBoardFn(),
        recurring: await listTemplatesFn(),
        toApprove: [],
        bids: [],
      }
    }
    return {
      waiting,
      waitingTemplates,
      priceChanges,
      board: [],
      recurring: [],
      toApprove: await listPendingCompletionsFn(),
      bids: await listBidsToAnswerFn(),
    }
  },
  component: Home,
})

// "Čeká na tebe" first, then the work lists; the rest of the home screens comes with #40, #41.
function Home() {
  const { user } = Route.useRouteContext()
  const { waiting, waitingTemplates, priceChanges, board, recurring, toApprove, bids } =
    Route.useLoaderData()
  return (
    <Screen title={`${cs.home.greeting}, ${user.displayName}!`} user={user}>
      <WaitingForYou
        items={waiting}
        templates={waitingTemplates}
        priceChanges={priceChanges}
        me={{ id: user.id, role: user.role }}
      />
      {user.role === 'taker' ? (
        <>
          <TakerBoard items={board} me={user.id} />
          <RecurringList items={recurring} waiting={priceChanges} />
        </>
      ) : (
        <>
          <ToApprove items={toApprove} />
          <BidsToAnswer items={bids} />
        </>
      )}
      <Placeholder />
    </Screen>
  )
}
