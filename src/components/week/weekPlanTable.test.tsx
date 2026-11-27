import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { cs } from '~/lib/strings'
import { PLAN_DAYS, PLAN_TODAY, planCopy, planFixture } from './fixtures'
import type { Viewer } from './planView'

// The plan table's drawing (#258): static markup only; taps are tested in e2e.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string
    params?: Record<string, string>
    children: ReactNode
    className?: string
  }) => (
    <a href={to.replace(/\$(\w+)/g, (_, k: string) => params?.[k] ?? '')} className={className}>
      {children}
    </a>
  ),
}))
vi.mock('~/server/tasks/functions', () => ({ reserveTaskFn: vi.fn(), releaseTaskFn: vi.fn() }))

const { WeekPlanTableView } = await import('./WeekPlanTable')
const { CopyListBody, ReleaseSheetBody, sheetTitle } = await import('./PlanSheets')

const ME: Viewer = { id: 3, role: 'taker' }
const GIVER: Viewer = { id: 2, role: 'giver' }
const render = (viewer: Viewer = ME, busyId: number | null = null, plan = planFixture()) =>
  renderToStaticMarkup(
    <WeekPlanTableView plan={plan} viewer={viewer} busyId={busyId} onTap={vi.fn()} />,
  )
const buttons = (html: string) => html.match(/<button[^>]*>/g) ?? []
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1]

describe('WeekPlanTableView (#258)', () => {
  it('renders every cell kind with its aria label; a blank day is no button', () => {
    const labels = buttons(render()).map((b) => attr(b, 'aria-label'))
    const t = 'Prostřít stůl k večeři'
    expect(labels).toEqual([
      `${t}, Po: prošlo`,
      `${t}, Út: hotovo, Starší`,
      `${t}, St: volné, rezervovat`,
      `${t}, Čt: rezervováno tebou, uvolnit`,
      `${t}, Pá: rezervováno, Mladší`,
      `${t}, So: čeká na potvrzení, Mladší`,
      `${t}, Ne: zrušeno`,
      'Vyluxovat celý obývák a chodbu, St: 2 kopie, otevřít seznam',
    ])
  })

  it('grid has one column per day: 8 days, 8 headers, repeat(8, …)', () => {
    const html = render()
    expect(html).toContain('--plan-portrait:repeat(8, 64px)')
    expect(html).toContain('--plan-landscape:repeat(8, minmax(48px, 1fr))')
    expect(html.match(/data-header=""/g)).toHaveLength(8)
    const seven = render(ME, null, planFixture({ days: PLAN_DAYS.slice(1) }))
    expect(seven).toContain('repeat(7, 64px)')
  })

  it("today's header is aria-current=date; past cells carry data-past and a light opacity-70 dim", () => {
    const html = render()
    const current = html.match(/<div[^>]*aria-current="date"[^>]*>/g) ?? []
    expect(current).toHaveLength(1)
    expect(attr(current[0] ?? '', 'data-day')).toBe(PLAN_TODAY)
    const past = buttons(html).filter((b) => b.includes('data-past'))
    expect(past.map((b) => attr(b, 'data-day'))).toEqual([PLAN_DAYS[1], PLAN_DAYS[2]])
    expect(html).toMatch(/opacity-70"><button[^>]*data-past/)
    expect(html).not.toContain('opacity-50')
    expect(buttons(html).filter((b) => b.includes('data-today'))).toHaveLength(2)
  })

  it('long name: three lines in portrait, two in landscape, in the pinned column; full name in the aria label', () => {
    const html = render()
    const title = /<span class="([^"]*)">Vyluxovat celý obývák a chodbu</
      .exec(html)?.[1]
      ?.split(' ')
    expect(title).toEqual(
      expect.arrayContaining(['line-clamp-3', 'landscape:line-clamp-2', 'break-words']),
    )
    expect(html).toContain('aria-label="Vyluxovat celý obývák a chodbu, St:')
    expect(html).toMatch(/truncate[^>]*>Út, Pá</)
    expect(html).toMatch(/truncate[^>]*>každý den</)
  })

  it('busy: every cell disabled, the busy one aria-busy with a spinner', () => {
    const html = render(ME, 103)
    const all = buttons(html)
    expect(all.every((b) => b.includes('disabled=""'))).toBe(true)
    const busy = all.filter((b) => b.includes('aria-busy="true"'))
    expect(busy.map((b) => attr(b, 'aria-label'))).toEqual([
      'Prostřít stůl k večeři, St: volné, rezervovat',
    ])
    expect(buttons(render()).some((b) => b.includes('disabled=""'))).toBe(false)
  })

  it('spinner has motion-reduce:animate-none', () => {
    expect(render(ME, 103)).toMatch(/animate-spin motion-reduce:animate-none/)
  })

  it('cells and sheet buttons are at least 44 px', () => {
    const sheets = renderToStaticMarkup(
      <>
        <ReleaseSheetBody
          copy={planCopy({ id: 104 })}
          busy={false}
          onRelease={vi.fn()}
          onClose={vi.fn()}
        />
        <CopyListBody
          copies={planFixture().rows[1]?.cells[3] ?? []}
          viewer={ME}
          busyId={null}
          onAction={vi.fn()}
        />
      </>,
    )
    for (const tag of [
      ...buttons(render()),
      ...buttons(sheets),
      ...(sheets.match(/<a [^>]*>/g) ?? []),
    ])
      expect(tag).toMatch(/min-h-tap|size-tap/)
  })

  it('no period: Týden ještě nezačal; no rows: the no-rows line', () => {
    expect(render(ME, null, planFixture({ period: null, days: [], rows: [] }))).toContain(
      cs.week.noPeriod,
    )
    expect(render(ME, null, planFixture({ rows: [] }))).toContain(
      'Žádný opakovaný úkol nemá pevné dny.',
    )
  })

  it('portrait hints are landscape:hidden; the tap hint shows for a taker only', () => {
    const html = render()
    expect(html).toMatch(/data-slot="turn-hint"[^>]*landscape:hidden/)
    expect(html).toMatch(/data-slot="scroll-hint"[^>]*landscape:hidden/)
    expect(html).toContain(cs.plan.tapHint)
    expect(render(GIVER)).not.toContain(cs.plan.tapHint)
    // The legend shows in both orientations.
    expect(html).toMatch(/data-slot="plan-legend" class="[^"]*"/)
    expect(html).not.toMatch(/data-slot="plan-legend" class="[^"]*landscape:hidden/)
  })

  it('a parent sees the same cells with a plain free label', () => {
    const labels = buttons(render(GIVER)).map((b) => attr(b, 'aria-label'))
    expect(labels).toContain('Prostřít stůl k večeři, St: volné')
    expect(labels).toContain('Prostřít stůl k večeři, Čt: rezervováno, Starší')
  })
})

describe('the sheets (#258)', () => {
  it('ReleaseSheet: Uvolnit, Zavřít and Otevřít úkol (href /ukol/<id>), title with the day', () => {
    const html = renderToStaticMarkup(
      <ReleaseSheetBody
        copy={planCopy({ id: 104, score: 2 })}
        busy={false}
        onRelease={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(html).toContain('>Uvolnit</button>')
    expect(html).toContain('>Zavřít</button>')
    expect(html).toMatch(/<a href="\/ukol\/104"[^>]*>Otevřít úkol/)
    expect(html).toContain('Rezervováno tebou · 2 body')
    expect(sheetTitle({ title: 'Prostřít stůl k večeři' }, PLAN_TODAY)).toBe(
      'Prostřít stůl k večeři · St 2. 12.',
    )
  })

  it('ReleaseSheet busy: Uvolnit disabled with a spinner', () => {
    const html = renderToStaticMarkup(
      <ReleaseSheetBody copy={planCopy({ id: 104 })} busy onRelease={vi.fn()} onClose={vi.fn()} />,
    )
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"/)
    expect(html).toContain('motion-reduce:animate-none')
  })

  it('CopyListSheet: a taker gets Rezervovat / Uvolnit buttons; a giver gets links to each copy', () => {
    const copies = planFixture().rows[1]?.cells[3] ?? []
    const taker = renderToStaticMarkup(
      <CopyListBody copies={copies} viewer={ME} busyId={null} onAction={vi.fn()} />,
    )
    expect(taker).toContain('Podle rozvrhu · Volné')
    expect(taker).toContain('>Rezervovat</button>')
    expect(taker).toContain('Navíc 14:20 · rezervováno tebou')
    expect(taker).toContain('>Uvolnit</button>')
    expect(taker).not.toContain('<a ')
    const giver = renderToStaticMarkup(
      <CopyListBody copies={copies} viewer={GIVER} busyId={null} onAction={vi.fn()} />,
    )
    expect(giver).not.toContain('<button')
    expect(giver.match(/<a href="\/ukol\/(\d+)"/g)).toEqual([
      '<a href="/ukol/201"',
      '<a href="/ukol/202"',
    ])
  })
})
