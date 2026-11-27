import { cs } from '~/lib/strings'

/**
 * The public demo's marker, first in the page on every screen (#328). Sticky at the top; sheets
 * and dialogs (z-50) cover it. Not focusable, not a landmark. Surface on the proposed-state
 * purple: the pair theme.test.ts already holds to 4.5:1 in light and dark (6.3:1 and 6.0:1).
 */
export function DemoMarker({ demo }: { demo: boolean }) {
  if (!demo) return null
  return (
    <p
      data-slot="demo-marker"
      className="pointer-events-none sticky top-0 z-40 bg-state-proposed-text px-4 py-1 text-center text-xs font-extrabold break-words text-surface"
    >
      {cs.demo.marker}
    </p>
  )
}
