import { Link } from '@tanstack/react-router'
import { CalendarDays, CirclePlus, House, ListTodo, Users, type LucideIcon } from 'lucide-react'
import type { Role } from '~/domain/parties'
import type { Features } from '~/lib/features'
import { navItems, type NavKey } from '~/lib/nav'
import { cs } from '~/lib/strings'

const ICONS: Record<NavKey, LucideIcon> = {
  home: House,
  log: CirclePlus,
  week: CalendarDays,
  tasks: ListTodo,
  meeting: Users,
}

/** The role's bottom bar (UI doc §6). Renders nothing for the admin. */
export function BottomNav({ role, features }: { role: Role; features: Readonly<Features> }) {
  const items = navItems(role, features)
  if (items.length === 0) return null
  return (
    <nav
      aria-label={cs.nav.label}
      className="fixed inset-x-0 bottom-0 z-40 bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_0_var(--shadow)]"
    >
      <ul className="mx-auto flex max-w-md justify-around px-2 pt-1.5 pb-2">
        {items.map(({ to, key }) => {
          const Icon = ICONS[key]
          return (
            <li key={to}>
              <Link
                to={to}
                activeOptions={{ exact: to === '/' }}
                className="relative flex min-h-12 min-w-16 flex-col items-center justify-center gap-0.5 text-chip font-extrabold text-muted before:absolute before:top-0 before:h-1 before:w-8 before:rounded-full data-[status=active]:text-accent-strong data-[status=active]:before:bg-accent-strong"
              >
                <Icon aria-hidden="true" className="size-6" strokeWidth={2} />
                {cs.nav[key]}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
