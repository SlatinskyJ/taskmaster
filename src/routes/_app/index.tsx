import { createFileRoute } from '@tanstack/react-router'
import { MyPoints } from '~/components/points/MyPoints'
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
import { getPointsFn } from '~/server/points/functions'
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
        points: await getPointsFn(),
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

// A taker's points card first (it belongs to the header, spec §7 sketch), then "Čeká na tebe",
// then the work lists. The giver's home comes with #41.
function Home() {
  const { user } = Route.useRouteContext()
  const data = Route.useLoaderData()
  const { waiting, waitingTemplates, priceChanges, board, recurring, toApprove, bids } = data
  const points = 'points' in data ? data.points : undefined
  return (
    <Screen title={`${cs.home.greeting}, ${user.displayName}!`} user={user}>
      {points && <MyPoints points={points} me={user.id} />}
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
