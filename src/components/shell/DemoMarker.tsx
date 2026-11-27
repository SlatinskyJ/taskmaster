import { cs } from '~/lib/strings'

/**
 * The public demo's marker, first in the page on every screen (#328). Sticky at the top; sheets
 * and dialogs (z-50) cover it. Not focusable, not a landmark.
 */
export function DemoMarker({ demo }: { demo: boolean }) {
  if (!demo) return null
  return (
    <p
      data-slot="demo-marker"
      className="pointer-events-none sticky top-0 z-40 bg-accent2 px-4 py-1 text-center text-xs font-extrabold break-words text-ink"
    >
      {cs.demo.marker}
    </p>
  )
}
