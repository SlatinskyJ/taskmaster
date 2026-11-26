import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { planFixture } from '~/components/week/fixtures'
import { cs } from '~/lib/strings'
import type { PlanAnswer } from '~/server/instances/functions'

// The week plan block in Schůzka step 3 (#259): static markup only; taps are tested in e2e.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn() }),
  Link: ({ to, children }: { to?: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))
vi.mock('~/server/tasks/functions', () => ({ reserveTaskFn: vi.fn(), releaseTaskFn: vi.fn() }))
vi.mock('~/server/instances/functions', () => ({ getWeekPlanFn: vi.fn() }))

const { MeetingWeekPlanView } = await import('./MeetingWeekPlan')

const render = (plan: PlanAnswer = planFixture(), busy = false, failed = false) =>
  renderToStaticMarkup(
    <MeetingWeekPlanView
      plan={plan}
      busy={busy}
      failed={failed}
      viewerId={2}
      onRefresh={vi.fn()}
    />,
  )
const refreshButton = (html: string) =>
  /<button[^>]*>(?:(?!<\/button>).)*Obnovit(?:(?!<\/button>).)*<\/button>/s.exec(html)?.[0] ?? ''

describe('MeetingWeekPlanView', () => {
  it('header, week, hint and a giver table', () => {
    const html = render()
    expect(html).toContain(`>${cs.plan.title}<`)
    expect(html).toContain('29. 11. – 6. 12.')
    expect(html).toContain(cs.meeting.planHint)
    expect(html).toContain(cs.meeting.refresh)
    expect(html).toContain('aria-label="Prostřít stůl k večeři, St: volné"')
    expect(html).not.toContain(cs.plan.tapHint)
    expect(html).toContain('aria-labelledby="meeting-plan-label"')
    expect(html).toContain('id="meeting-plan-label"')
    expect(html).not.toContain('role="alert"')
  })

  it('busy: Obnovit disabled, aria-busy, spinner has motion-reduce', () => {
    const button = refreshButton(render(planFixture(), true))
    expect(button).toContain('disabled=""')
    expect(button).toContain('aria-busy="true"')
    expect(button).toContain('animate-spin')
    expect(button).toContain('motion-reduce:animate-none')
    expect(button).toContain(cs.meeting.refresh)
  })

  it('not busy: Obnovit enabled, no spin', () => {
    const button = refreshButton(render())
    expect(button).not.toContain('disabled=""')
    expect(button).not.toContain('animate-spin')
  })

  it('refresh failed: message, table still there, button enabled', () => {
    const html = render(planFixture(), false, true)
    expect(html).toContain('role="alert"')
    expect(html).toContain(cs.meeting.refreshFailed)
    expect(html).toContain('aria-label="Prostřít stůl k večeři, St: volné"')
    expect(refreshButton(html)).not.toContain('disabled=""')
  })

  it('feature_off answer renders nothing', () => {
    expect(render({ error: 'feature_off' })).toBe('')
  })

  it('empty plan: #258 empty state under the header', () => {
    const none = render(planFixture({ period: null, rows: [] }))
    expect(none).toContain(`>${cs.plan.title}<`)
    expect(none).toContain(cs.week.noPeriod)
    const noRows = render(planFixture({ rows: [] }))
    expect(noRows).toContain(cs.plan.noRows)
    expect(noRows).toContain('29. 11. – 6. 12.')
  })

  it('tap targets: Obnovit is at least 44 px and stays whole', () => {
    const button = refreshButton(render())
    expect(button).toContain('min-h-tap')
    expect(button).toContain('shrink-0')
  })
})
