import { createFileRoute } from '@tanstack/react-router'
import { ComingSoon } from '~/components/shell/ComingSoon'
import { guardScreen } from '~/lib/routeGuard'
import { cs } from '~/lib/strings'

// Placeholder for the meeting tab (UI doc §6); its feature issue fills it in.
export const Route = createFileRoute('/_app/schuzka')({
  beforeLoad: ({ context }) => {
    guardScreen(context.user.role, '/schuzka')
  },
  component: MeetingScreen,
})

function MeetingScreen() {
  return <ComingSoon title={cs.nav.meeting} />
}
