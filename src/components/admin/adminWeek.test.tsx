import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import type { AdminWeek } from '~/server/settlement/functions'
import { AdminWeekScreen } from './AdminWeekScreen'

// The admin's view of a brother's week (#263), rendered statically.
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

const LONG = 'Vyluxovat celý obývák a chodbu'

const record = (over: Partial<NonNullable<AdminWeek['record']>> = {}) => ({
  id: 7,
  takerId: 2,
  name: 'Mladší',
  totalBefore: 108,
  level: 'upper' as const,
  deducted: 100,
  carryOver: 8,
  dispute: null,
  correction: null,
  adjustments: [],
  ...over,
})

function adminWeek(over: Partial<AdminWeek> = {}): AdminWeek {
  return {
    taker: { id: 2, name: 'Mladší' },
    week: {
      periodId: 4,
      startsAt: '2026-11-21T19:00:00.000Z',
      endsAt: '2026-11-29T19:00:00.000Z',
      levels: { lower: 50, upper: 100 },
    },
    record: record(),
    carriedIn: 12,
    items: [
      {
        taskId: 31,
        title: LONG,
        score: 40,
        status: 'confirmed',
        at: '2026-11-25T15:00:00.000Z',
      },
      {
        taskId: 32,
        title: 'Vynést koš',
        score: 3,
        status: 'done_unconfirmed',
        at: '2026-11-24T15:00:00.000Z',
      },
    ],
    adjustments: [
      {
        id: 9,
        points: 5,
        reason: 'Pomoc s nákupem.',
        at: '2026-11-23T10:00:00.000Z',
        fromWeek: null,
        waiting: false,
        dispute: null,
      },
    ],
    ...over,
  }
}

const html = (w: AdminWeek) => renderToStaticMarkup(<AdminWeekScreen week={w} />)

describe('AdminWeekScreen', () => {
  it('a settled week: its week, levels, level, history line, carry-in and both kinds of row', () => {
    const out = html(adminWeek())
    expect(out).toContain('21. 11. – 29. 11.')
    expect(out).toMatch(/Hranice(<!-- -->)? (<!-- -->)?50(<!-- -->)? \/(<!-- -->)? (<!-- -->)?100/)
    expect(out).toContain(`>${cs.meeting.level.upper}<`)
    expect(out).toContain('Celkem 108 · odečteno 100 · převod 8')
    expect(out).toContain('Z minula převedeno 12 bodů')
    expect(out).not.toContain(cs.admin.week.notSettled)
    expect(out).toContain(cs.admin.week.happened)
    expect(out).toContain(cs.week.adjustment)
    expect(out).toContain('Pomoc s nákupem.')
    expect(out).toContain('+5')
    expect(out).toContain('Vynést koš')
    expect(out).toContain('data-state="confirmed"')
    expect(out).toContain('data-state="pending"')
    // Adjustments first, then the items.
    expect(out.indexOf(cs.week.adjustment)).toBeLessThan(out.indexOf(LONG))
  })

  it('a corrected week: the corrected level badge and the correction line', () => {
    const out = html(
      adminWeek({
        record: record({
          correction: {
            level: 'lower',
            deducted: 50,
            reason: 'Spletli jsme se',
            at: '2026-11-30T10:00:00.000Z',
          },
        }),
      }),
    )
    expect(out).toContain(`>${cs.meeting.level.lower}<`)
    expect(out).not.toContain(`>${cs.meeting.level.upper}<`)
    expect(out).toContain('Spletli jsme se')
    expect(out).toContain('Celkem 108 · odečteno 100 · převod 8')
  })

  it('a week not settled yet: the line, no level badge', () => {
    const out = html(adminWeek({ record: null }))
    expect(out).toContain(cs.admin.week.notSettled)
    for (const l of Object.values(cs.meeting.level)) expect(out).not.toContain(`>${l}<`)
    expect(out).not.toContain(cs.week.total)
    expect(out).toContain('Z minula převedeno 12 bodů')
  })

  it('an empty week: the empty line', () => {
    const out = html(adminWeek({ items: [], adjustments: [] }))
    expect(out).toContain(cs.admin.week.noItems)
    expect(out).not.toContain('data-slot="task-row"')
  })

  it('a task row opens its task page', () => {
    expect(html(adminWeek())).toContain('href="/ukol/31"')
  })

  it('a long name is there whole, in a container that wraps', () => {
    const out = html(adminWeek())
    expect(out).toMatch(new RegExp(`class="[^"]*break-words[^"]*"><a[^>]*>${LONG}</a>`))
  })

  it('no Rozporovat: the admin is not a party', () => {
    expect(html(adminWeek())).not.toContain('Rozporovat')
  })
})
