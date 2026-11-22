import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { LogConfirm, LogTiles } from '~/components/instances/LogTiles'
import type { LogTile } from '~/components/instances/LogTiles'
import { Screen } from '~/components/shell/Screen'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { listLoggableTemplatesFn } from '~/server/instances/functions'

// Zapsat: a taker logs a chore done unprompted (UI doc §6, §7.1 TLog, #38). Tiles of every
// agreed template; a tap asks first, then it waits for a parent's approval (spec §5.3).
export const Route = createFileRoute('/_app/zapsat')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/zapsat')
  },
  loader: () => listLoggableTemplatesFn(),
  component: LogChore,
})

function LogChore() {
  const { user } = Route.useRouteContext()
  const templates = Route.useLoaderData()
  const [picked, setPicked] = useState<LogTile | null>(null)
  return (
    <Screen title={cs.nav.log} user={user}>
      <p className="text-muted">{cs.log.intro}</p>
      <LogTiles templates={templates} onPick={setPicked} />
      <LogConfirm
        tile={picked}
        onClose={() => {
          setPicked(null)
        }}
      />
    </Screen>
  )
}
