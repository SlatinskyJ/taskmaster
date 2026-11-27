import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { LogConfirm, LogTiles } from '~/components/instances/LogTiles'
import type { LogTile } from '~/components/instances/LogTiles'
import { Screen } from '~/components/shell/Screen'
import type { LogWhen } from '~/domain'
import { liveSubs } from '~/lib/liveSubs'
import { guardScreen } from '~/lib/screenGuard'
import { cs } from '~/lib/strings'
import { listLoggableTemplatesFn } from '~/server/instances/functions'

// Zapsat: a taker logs a chore done unprompted (UI doc §6, §7.1 TLog, #38). Tiles of every
// agreed template; a tap asks first, then it waits for a parent's approval (spec §5.3).
export const Route = createFileRoute('/_app/zapsat')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/zapsat')
  },
  loader: async () => {
    const live = liveSubs()
    const { tiles, choices } = live.take(await listLoggableTemplatesFn())
    return { tiles, choices, live: live.all() }
  },
  component: LogChore,
})

function LogChore() {
  const { user } = Route.useRouteContext()
  const { tiles, choices } = Route.useLoaderData()
  const [picked, setPicked] = useState<LogTile | null>(null)
  const [when, setWhen] = useState<LogWhen>('now')
  return (
    <Screen title={cs.nav.log} user={user}>
      <p className="text-muted">{cs.log.intro}</p>
      <LogTiles
        templates={tiles}
        onPick={(tile) => {
          setWhen('now')
          setPicked(tile)
        }}
      />
      <LogConfirm
        tile={picked}
        when={when}
        choices={choices}
        onWhen={setWhen}
        onClose={() => {
          setPicked(null)
        }}
      />
    </Screen>
  )
}
