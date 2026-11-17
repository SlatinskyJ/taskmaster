import { EmptyState } from '~/components/EmptyState'
import { cs } from '~/lib/strings'

/** Body of a nav target whose content lands in a later issue. */
export function Placeholder() {
  return <EmptyState>{cs.placeholder.soon}</EmptyState>
}
