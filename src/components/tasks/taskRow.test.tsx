import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { taskLink, templateLink } from './rowLink'
import { TaskRow } from './TaskRow'

// A row that opens its page (#205): a stretched link on the name, buttons above it.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string
    params: Record<string, string>
    children: ReactNode
    className?: string
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_, k: string) => params[k] ?? '')} className={className}>
      {children}
    </a>
  ),
}))

// Rendered on main before #205: a row without a link must stay exactly this.
const PLAIN =
  '<div data-slot="task-row" data-state="open" class="relative rounded-card border-l-4 bg-surface py-2.5 pr-2.5 pl-3 shadow-sticker flex min-h-tap items-center gap-3 border-l-state-open"><div class="grid min-w-0 flex-1 gap-1"><div class="line-clamp-2 text-row font-bold break-words">Umýt okna</div><div data-slot="task-status" class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted"><span data-slot="badge" class="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-body text-chip font-bold whitespace-nowrap bg-state-open/15 text-state-open-text max-w-full" data-state="open"><span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-state-open"></span><span class="truncate">Volné</span></span><span data-slot="task-meta" class="max-w-full truncate">m</span></div></div><span class="num text-base font-bold whitespace-nowrap">5</span><button>A</button></div>'
const PLAIN_FOOTER =
  '<div data-slot="task-row" data-state="open" class="relative rounded-card border-l-4 bg-surface py-2.5 pr-2.5 pl-3 shadow-sticker grid gap-1.5 border-l-state-open"><div class="flex min-h-tap items-center gap-3"><div class="grid min-w-0 flex-1 gap-1"><div class="line-clamp-2 text-row font-bold break-words">Umýt okna</div><div data-slot="task-status" class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-muted"><span data-slot="badge" class="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-body text-chip font-bold whitespace-nowrap bg-state-open/15 text-state-open-text max-w-full" data-state="open"><span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-state-open"></span><span class="truncate">Volné</span></span></div></div><span class="num text-base font-bold whitespace-nowrap">5</span><button>A</button></div><button>F</button></div>'

const row = (link?: ReturnType<typeof taskLink>, footer?: ReactNode) =>
  renderToStaticMarkup(
    <TaskRow
      name="Umýt okna"
      state="open"
      points={5}
      meta={footer ? undefined : 'm'}
      action={<button>A</button>}
      footer={footer}
      link={link}
    />,
  )

describe('TaskRow link (#205)', () => {
  it('without a link the markup is what it was', () => {
    expect(row()).toBe(PLAIN)
    expect(row(undefined, <button>F</button>)).toBe(PLAIN_FOOTER)
  })

  it('the name is one stretched link to its page', () => {
    const html = row(taskLink(7))
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toMatch(
      /<a href="\/ukol\/7" class="[^"]*after:absolute after:inset-0[^"]*">Umýt okna<\/a>/,
    )
    expect(row(templateLink(4))).toContain('href="/sablona/4"')
  })

  it('the action and the footer sit above the link', () => {
    expect(row(taskLink(7))).toContain(
      '<div class="relative z-10 shrink-0"><button>A</button></div>',
    )
    expect(row(taskLink(7), <button>F</button>)).toContain(
      '<div class="relative z-10"><button>F</button></div>',
    )
  })
})
