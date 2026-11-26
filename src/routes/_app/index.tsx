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
import { liveSubs } from '~/lib/liveSubs'
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
import { listDescriptionChangesWaitingFn } from '~/server/descriptions/functions'
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
    // Every data function's live subscription, in call order (#299, src/lib/liveSubs.ts).
    const live = liveSubs()
    const waiting = live.take(await listPendingApprovalsFn())
    const waitingTemplates = live.take(await listPendingTemplateApprovalsFn())
    const priceChanges = live.take(await listPendingTemplatePriceChangesFn())
    const taskPriceChanges = live.take(await listScoreChangesWaitingFn())
    // Proposals for next week (#43): only with the launch switch on, so off means no call.
    const proposals = context.features.periodProposals ? await getProposalsFn() : null
    if (context.user.role === 'taker') {
      // Waiting description changes (#207 ruling 6): only a brother answers them, only with the switch on.
      const descriptionChanges = context.features.descriptions
        ? live.take(await listDescriptionChangesWaitingFn())
        : []
      return {
        descriptionChanges,
        waiting,
        waitingTemplates,
        priceChanges,
        taskPriceChanges,
        proposals,
        board: live.take(await listBoardFn()),
        recurring: live.take(await listTemplatesFn()),
        toApprove: [],
        bids: [],
        tasks: [],
        points: await getPointsFn(),
        live: live.all(),
      }
    }
    return {
      descriptionChanges: [],
      waiting,
      waitingTemplates,
      priceChanges,
      taskPriceChanges,
      proposals,
      board: [],
      recurring: [],
      toApprove: live.take(await listPendingCompletionsFn()),
      bids: live.take(await listBidsToAnswerFn()),
      tasks: live.take(await listTasksFn()),
      points: await getPointsFn(),
      live: live.all(),
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
    descriptionChanges,
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
  const links = features.openRows
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
      {approveOnTop && <ToApprove items={toApprove} links={links} />}
      <WaitingForYou
        items={waiting}
        templates={shownTemplates}
        priceChanges={shownPriceChanges}
        taskPriceChanges={taskPriceChanges}
        descriptionChanges={descriptionChanges}
        proposals={proposalRows}
        me={{ id: user.id, role: user.role }}
        links={links}
      />
      {user.role === 'taker' ? (
        <>
          <TakerBoard items={board} me={user.id} rebid={features.reopenBidding} links={links} />
          {features.recurring && (
            <RecurringList items={recurring} waiting={priceChanges} links={links} />
          )}
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
            links={links}
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
