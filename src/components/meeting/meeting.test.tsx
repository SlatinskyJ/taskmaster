import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type * as ButtonModule from '~/components/ui/button'
import type { Meeting } from '~/server/settlement/functions'
import type { TaskView } from '~/server/tasks/functions'
import { pendingWeek, settledOk, task, week } from './fixtures'
import { MeetingBody } from './MeetingScreen'
import { reduce, START } from './meetingFlow'
import type { MeetingEvent, MeetingUi } from './meetingFlow'

// The meeting screen (#44) rendered statically for each state from meetingFlow.ts. Button
// records each label's click handler and disabled flag so a test can press it.
const pressed = vi.hoisted(
  () => new Map<string, { onClick?: () => void; disabled?: boolean | undefined }>(),
)
vi.mock('~/components/ui/button', async (original) => {
  const real = await original<typeof ButtonModule>()
  return {
    ...real,
    Button: (props: Parameters<typeof real.Button>[0]) => {
      const name = typeof props.children === 'string' ? props.children : props['aria-label']
      if (name !== undefined) {
        pressed.set(name, {
          onClick: props.onClick as (() => void) | undefined,
          disabled: props.disabled,
        })
      }
      return real.Button(props)
    },
  }
})
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ children, to, params }: { children: ReactNode; to: string; params?: object }) => (
    <a href={params ? to.replace('$taskId', String(Object.values(params)[0])) : to}>{children}</a>
  ),
}))
vi.mock('~/server/settlement/functions', () => ({ settlePeriodFn: vi.fn() }))
vi.mock('~/server/tasks/functions', () => ({ approveTaskFn: vi.fn(), rejectTaskFn: vi.fn() }))

const names = [
  { id: 3, name: 'Starší' },
  { id: 4, name: 'Mladší' },
]

function render(meeting: Meeting, ui: MeetingUi = START, plan: TaskView[] = []) {
  pressed.clear()
  const dispatch = vi.fn<(e: MeetingEvent) => void>()
  const onConfirm = vi.fn()
  const html = renderToStaticMarkup(
    <MeetingBody meeting={meeting} plan={plan} ui={ui} dispatch={dispatch} onConfirm={onConfirm} />,
  )
  return { html, dispatch, onConfirm }
}
const press = (label: string) => {
  const b = pressed.get(label)
  if (!b?.onClick) throw new Error(`no button ${label}`)
  b.onClick()
}
const step2: MeetingUi = { ...START, advanced: true }
const done = reduce(START, { type: 'answer', result: settledOk, names })

describe('step 1: Schválit', () => {
  it('pending items show step 1 and lock step 2', () => {
    const { html } = render(pendingWeek())
    expect(html).toContain('aria-current="step"')
    expect(html).toMatch(/data-step="current".*Schválit/s)
    expect(html).toContain('Vyluxovat celý obývák a chodbu')
    expect(html).toContain('Hotová práce do neděle 29. 11. 20:00.')
    expect(html).toContain('22. 11. – 29. 11.')
    expect(pressed.get('Zbývá schválit: 2')?.disabled).toBe(true)
  })

  it('approving the last pending item unlocks step 2', () => {
    // The loader reloads after each approval; the screen renders the new props.
    const { html, dispatch } = render(week())
    expect(html).toContain('Vše vyřízeno')
    expect(pressed.get('Dál: vyúčtovat')?.disabled).toBe(false)
    press('Dál: vyúčtovat')
    expect(dispatch).toHaveBeenCalledWith({ type: 'next' })
  })
})

describe('step 2: Vyúčtovat', () => {
  it("shows each taker's total, level, deduction and carry-over", () => {
    const { html } = render(week(), step2)
    expect(html).toMatch(/data-taker="3".*Starší.*Horní hranice.*130.*−100.*30/s)
    expect(html).toMatch(/data-taker="4".*Mladší.*Bez kapesného.*47.*>0<.*47/s)
    expect(html).toContain('Chyběly 3 body. Nic nepropadá, 47 bodů jde do dalšího týdne.')
    expect(html).toContain('Vyúčtování je konečné. Opravit ho může jen správce.')
  })

  it('confirm asks first; Zpět sends nothing', () => {
    const first = render(week(), step2)
    press('Potvrdit vyúčtování')
    expect(first.dispatch).toHaveBeenCalledWith({ type: 'ask' })
    expect(first.onConfirm).not.toHaveBeenCalled()

    const asking = render(week(), { ...step2, asking: true })
    expect(asking.html).toContain('Vyúčtovat týden?')
    press('Zpět')
    expect(asking.dispatch).toHaveBeenCalledWith({ type: 'back' })
    expect(asking.onConfirm).not.toHaveBeenCalled()
    press('Vyúčtovat')
    expect(asking.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('the buttons are disabled while the confirm runs', () => {
    render(week(), { ...step2, asking: true, busy: true })
    expect(pressed.get('Vyúčtovat')?.disabled).toBe(true)
    expect(pressed.get('Zpět')?.disabled).toBe(true)
  })

  it('totals_changed: the screen shows the reloaded totals', () => {
    const changed = week({
      takers: [{ id: 3, name: 'Starší', total: 98, level: 'lower', deducted: 50, carryOver: 48 }],
    })
    const { html } = render(changed, step2)
    expect(html).toMatch(/Starší.*Spodní hranice.*98.*−50.*48/s)
    expect(html).not.toContain('130')
  })
})

describe('step 3: Plánovat', () => {
  it("shows each taker's carry-over by takerId and the new week from the response", () => {
    const { html } = render(week(), done)
    expect(html).toMatch(/data-step="current".*Plánovat/s)
    expect(html).toContain('Vyúčtováno · ne 29. 11. 20:00')
    expect(html).toContain('Nový týden 29. 11. – 6. 12. · Hranice 50 / 100')
    expect(html).toMatch(/data-start="3".*Starší.*>30<.*data-start="4".*Mladší.*>47</s)
    expect(html).not.toContain('Potvrdit vyúčtování')
  })

  it('a confirm with next null shows the week still running', () => {
    const late = reduce(START, {
      type: 'answer',
      result: { ...settledOk, next: null },
      names,
    })
    const { html } = render({ period: null }, late)
    expect(html).toContain('Tento týden běží dál')
    expect(html).not.toContain('Nový týden')
    expect(html).toContain('Začínají s')
    expect(html).toMatch(/Starší.*>30</s)
  })

  it('nothing to settle shows step 3 only', () => {
    const { html } = render({ period: null })
    expect(html).toContain('Teď není co vyúčtovat')
    expect(html).not.toContain('Vyúčtováno')
    expect(html).not.toContain('Potvrdit vyúčtování')
  })

  it('lists the plan tasks and links to new task and home', () => {
    const plan = [
      task({
        id: 21,
        title: 'Umýt auto',
        status: 'proposed',
        score: 18,
        reservedBy: null,
        completedBy: null,
        bids: [{ takerId: 4, name: 'Mladší', score: 20 }],
        lowest: { score: 20, bidders: [{ id: 4, name: 'Mladší' }] },
      }),
      task({ id: 22, title: 'Vynést koš', status: 'reserved', score: 2, completedBy: null }),
    ]
    const { html } = render(week(), done, plan)
    expect(html).toMatch(/href="\/ukol\/21".*Umýt auto.*Mladší chce 20.*Odpovědět/s)
    expect(html).toMatch(/href="\/ukol\/22".*Vynést koš.*Rezervoval Starší/s)
    expect(html).toMatch(/href="\/ukoly\/novy">\+ Nový úkol/)
    expect(html).toMatch(/href="\/">Ukončit schůzku/)
  })

  it('with no tasks shows the empty state', () => {
    const { html } = render(week(), done)
    expect(html).toContain('Na tento týden zatím nic. Přidej úkol.')
  })
})
