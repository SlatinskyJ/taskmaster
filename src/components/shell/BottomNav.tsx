import { Link } from '@tanstack/react-router'
import { CalendarDays, House, ListChecks, type LucideIcon, PenLine, Users } from 'lucide-react'
import { cs } from '~/lib/strings'
import type { NavItem, NavKey } from '~/lib/nav'

const ICONS: Record<NavKey, LucideIcon> = {
  home: House,
  log: PenLine,
  week: CalendarDays,
  tasks: ListChecks,
  meeting: Users,
}

/** Bottom bar for takers and givers (UI doc §6). Fixed, above the phone's home indicator. */
export function BottomNav({ items }: { items: readonly NavItem[] }) {
  return (
    <nav
      aria-label={cs.nav.main}
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-track bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul
        className="mx-auto grid max-w-lg px-2"
        style={{ gridTemplateColumns: `repeat(${String(items.length)}, minmax(0, 1fr))` }}
      >
        {items.map(({ key, to }) => {
          const Icon = ICONS[key]
          return (
            <li key={key}>
              <Link
                to={to}
                activeOptions={{ exact: to === '/' }}
                className="group flex min-h-14 flex-col items-center justify-center gap-0.5 font-display text-meta font-semibold text-muted data-[status=active]:text-accent-strong"
              >
                <span className="grid h-7 w-12 place-items-center rounded-full transition-colors group-data-[status=active]:bg-tint">
                  <Icon className="size-5" aria-hidden />
                </span>
                {cs.nav[key]}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
