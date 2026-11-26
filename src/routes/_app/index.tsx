import { createFileRoute, Link } from '@tanstack/react-router'
import { EmptyState } from '~/components/EmptyState'
import { GiverHome } from '~/components/home/GiverHome'
import { MyPoints } from '~/components/points/MyPoints'
import { Screen } from '~/components/shell/Screen'
import { TakerBoard } from '~/components/tasks/TakerBoard'
import { RecurringList } from '~/components/templates/RecurringList'
import { ToApprove } from '~/components/tasks/ToApprove'
import { WaitingForYou } from '~/components/tasks/WaitingForYou'
import { buttonVariants } from '~/components/ui/button'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import {
  listBidsToAnswerFn,
  listBoardFn,
  listPendingApprovalsFn,
  listPendingCompletionsFn,
  listScoreChangesWaitingFn,
  listTasksFn,
} from '~/server/tasks/functions'
import { waitingProposals } from '~/components/proposals/proposalView'
import { getProposalsFn } from '~/server/periods/functions'
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
    const taskPriceChanges = await listScoreChangesWaitingFn()
    // Proposals for next week (#43): only with the launch switch on, so off means no call.
    const proposals = context.features.periodProposals ? await getProposalsFn() : null
    if (context.user.role === 'taker') {
      return {
        waiting,
        waitingTemplates,
        priceChanges,
        taskPriceChanges,
        proposals,
        board: await listBoardFn(),
        recurring: await listTemplatesFn(),
        toApprove: [],
        bids: [],
        tasks: [],
        points: await getPointsFn(),
      }
    }
    return {
      waiting,
      waitingTemplates,
      priceChanges,
      taskPriceChanges,
      proposals,
      board: [],
      recurring: [],
      toApprove: await listPendingCompletionsFn(),
      bids: await listBidsToAnswerFn(),
      tasks: await listTasksFn(),
      points: await getPointsFn(),
    }
  },
  component: Home,
})

// A taker's points card first (it belongs to the header, spec §7 sketch), then "Čeká na tebe",
// then the work lists. A parent's points overview sits under "Čeká na tebe" (GHome, #41). With the
// approveAnywhere switch, a parent's Ke schválení comes first, when anything waits (#206).
function Home() {
  const { user, features } = Route.useRouteContext()
  const {
    waiting,
    waitingTemplates,
    priceChanges,
    taskPriceChanges,
    proposals,
    board,
    recurring,
    toApprove,
    bids,
    tasks,
    points,
  } = Route.useLoaderData()
  const shownTemplates = features.recurring ? waitingTemplates : []
  const shownPriceChanges = features.recurring ? priceChanges : []
  const proposalRows =
    features.periodProposals && proposals && !('error' in proposals)
      ? waitingProposals(proposals, user.id)
      : []
  const approveOnTop = user.role === 'giver' && features.approveAnywhere
  const giverIdle =
    proposalRows.length +
      waiting.length +
      shownTemplates.length +
      shownPriceChanges.length +
      taskPriceChanges.length +
      toApprove.length +
      bids.length ===
    0
  return (
    <Screen title={`${cs.home.greeting}, ${user.displayName}!`} user={user}>
      {user.role === 'taker' && <MyPoints points={points} me={user.id} />}
      {approveOnTop && <ToApprove items={toApprove} />}
      <WaitingForYou
        items={waiting}
        templates={shownTemplates}
        priceChanges={shownPriceChanges}
        taskPriceChanges={taskPriceChanges}
        proposals={proposalRows}
        me={{ id: user.id, role: user.role }}
      />
      {user.role === 'taker' ? (
        <>
          <TakerBoard items={board} me={user.id} rebid={features.reopenBidding} />
          {features.recurring && <RecurringList items={recurring} waiting={priceChanges} />}
        </>
      ) : (
        <>
          <GiverHome
            points={points}
            tasks={tasks}
            toApprove={toApprove}
            bids={bids}
            me={{ id: user.id, role: user.role }}
            approveOnTop={approveOnTop}
          />
          {giverIdle && (
            <EmptyState
              action={
                <Link to="/ukoly/novy" className={buttonVariants({ variant: 'primary' })}>
                  {cs.tasks.createTitle}
                </Link>
              }
            >
              {cs.home.giverEmpty}
            </EmptyState>
          )}
        </>
      )}
    </Screen>
  )
}
