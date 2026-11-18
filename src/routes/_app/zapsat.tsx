import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '~/components/shell/ComingSoon'
import { guardScreen } from '~/lib/routeGuard'
import { cs } from '~/lib/strings'

// Placeholder for the log tab (UI doc §6); its feature issue fills it in.
export const Route = createFileRoute('/_app/zapsat')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/zapsat')
  },
  component: LogScreen,
})

function LogScreen() {
  return <ComingSoon title={cs.nav.log} />
}
