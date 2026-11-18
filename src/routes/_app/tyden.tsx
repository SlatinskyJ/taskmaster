import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '~/components/shell/ComingSoon'
import { guardScreen } from '~/lib/routeGuard'
import { cs } from '~/lib/strings'

// Placeholder for the week tab (UI doc §6); its feature issue fills it in.
export const Route = createFileRoute('/_app/tyden')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/tyden')
  },
  component: WeekScreen,
})

function WeekScreen() {
  return <ComingSoon title={cs.nav.week} />
}
