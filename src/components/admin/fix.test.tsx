import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import type { FixTaker } from '~/server/corrections/functions'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import { initialDraft } from './fixDraft'
import type { FixDraft, FixStart } from './fixDraft'
import { FixForm } from './FixForm'
import type { FixFormProps } from './FixForm'

// The fix sheet's body (#48): every state renders without the drawer.

const t = cs.admin.fix
const noop = () => undefined
const longName = 'Maxmilián Vojtěch Starší'
const week = {
  settlementId: 7,
  startsAt: '2026-11-14T19:00:00.000Z',
  endsAt: '2026-11-21T19:00:00.000Z',
  levels: { lower: 50, upper: 100 },
  totalBefore: 60,
  carryOver: 10,
  level: 'lower' as const,
  deducted: 50,
  corrected: true,
}
const fixable: FixTaker[] = [
  { id: 3, name: longName, total: 62, weeks: [week] },
  { id: 4, name: 'Mladší', total: 4, weeks: [] },
]
const reason = 'Vysával jsem i kufr a koberečky, to je mnohem víc práce než obyčejně. '.repeat(3)
const dispute: AdminDisputeEntry = {
  id: 9,
  item: { kind: 'completion', id: 10 },
  title: 'Vyluxovat celý obývák a chodbu',
  week: null,
  takerName: longName,
  takerId: 3,
  openedByName: longName,
  reason,
  openedAt: '2026-11-22T10:00:00.000Z',
  value: { score: 22 },
  page: null,
  weekPage: null,
}

function view(start: FixStart, over: Partial<FixDraft> = {}, props: Partial<FixFormProps> = {}) {
  return renderToStaticMarkup(
    <FixForm
      start={start}
      fixable={fixable}
      draft={{ ...initialDraft(start, ''), ...over }}
      busy={false}
      error={null}
      onChange={noop}
      onSend={noop}
      {...props}
    />,
  )
}

const submit = (html: string) => /<button[^>]*type="submit"[^>]*>(.*?)<\/button>/.exec(html)
const pill = (html: string, label: string) =>
  new RegExp(`<button[^>]*aria-pressed="(true|false)"[^>]*>(?:<span[^>]*>)*${label}`).exec(
    html,
  )?.[0] ?? ''

const direct: FixStart = { mode: 'points', takerId: null, dispute: null }
const fromDispute: FixStart = { mode: 'points', takerId: 3, dispute }
const weekDirect: FixStart = { mode: 'week', takerId: null, settlementId: null, dispute: null }

describe('FixForm points mode', () => {
  it('direct: every boy to pick, Přidat/Ubrat, the hint for an adjustment; send disabled', () => {
    const html = view(direct)
    expect(html).toContain(longName)
    expect(html).toContain('Mladší')
    expect(html).toContain(t.add)
    expect(html).toContain(t.remove)
    expect(html).toContain(t.hint)
    expect(submit(html)?.[0]).toMatch(/ disabled=""/)
    expect(submit(html)?.[1]).toBe(t.adjust)
  })

  it('complete: the preview, and the send button names the action and the boy', () => {
    const html = view(direct, { takerId: 3, amount: '5', sign: -1, reason: 'Hrnek.' })
    expect(html).toContain(t.preview(longName, 62, 57))
    expect(submit(html)?.[0]).not.toMatch(/ disabled=""/)
    expect(submit(html)?.[1]).toBe(t.sendRemove(5, longName))
  })

  it('Ubrat below zero warns; the server still decides', () => {
    const html = view(direct, { takerId: 4, amount: '5', sign: -1, reason: 'x' })
    expect(html).toContain(t.belowZero)
    expect(submit(html)?.[0]).not.toMatch(/ disabled=""/)
  })

  it('from a dispute: its summary with the long reason, the boy locked, the dispute hint', () => {
    const html = view(fromDispute)
    expect(html).toContain(reason.trim())
    expect(html).toContain('Vyluxovat celý obývák a chodbu')
    expect(html).toContain(t.hintDispute)
    expect(pill(html, 'Mladší')).toMatch(/ disabled=""/)
    expect(pill(html, longName)).toContain('aria-pressed="true"')
  })

  it('busy: Ukládám… and aria-busy; an error shows as an alert', () => {
    const busy = view(direct, { takerId: 3, amount: '5', reason: 'x' }, { busy: true })
    expect(submit(busy)?.[0]).toContain('aria-busy="true"')
    expect(submit(busy)?.[1]).toBe(t.saving)
    const failed = view(direct, {}, { error: t.errors.week_waiting })
    expect(failed).toContain(`role="alert"`)
    expect(failed).toContain(t.errors.week_waiting)
  })

  it('every pill and the send button are at least a tap high', () => {
    const html = view(direct)
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toContain('min-h-tap')
    expect(html).toMatch(/maxlength="1000"/i)
    expect(html).toMatch(/enterkeyhint="next"/i)
  })

  it('no boys: says so', () => {
    expect(
      renderToStaticMarkup(
        <FixForm
          start={direct}
          fixable={[]}
          draft={initialDraft(direct, '')}
          busy={false}
          error={null}
          onChange={noop}
          onSend={noop}
        />,
      ),
    ).toContain(t.noTakers)
  })
})

describe('FixForm week mode', () => {
  it('direct: after a boy, his weeks with level, numbers and „opraveno“', () => {
    const html = view(weekDirect, { takerId: 3 })
    expect(html).toContain('Spodní hranice')
    expect(html).toContain('Celkem 60 · odečteno 50 · převod 10')
    expect(html).toContain(t.corrected)
  })

  it('a boy with no settled week: says so', () => {
    expect(view(weekDirect, { takerId: 4 })).toContain(t.noWeeks)
  })

  it('a week picked: levels with the current one disabled; a level shows the difference', () => {
    const html = view(weekDirect, { takerId: 3, settlementId: 7, level: 'upper', reason: 'x' })
    expect(pill(html, 'Spodní hranice')).toMatch(/ disabled=""/)
    expect(pill(html, 'Horní hranice')).toContain('aria-pressed="true"')
    expect(html).toContain(t.difference(-50))
    expect(submit(html)?.[1]).toBe(t.sendCorrect('Horní hranice', longName))
    // The level's label stays in its own form: never after "na" (Czech case).
    expect(submit(html)?.[1]).toBe(`Opravit: Horní hranice – ${longName}`)
  })

  it('from a settlement dispute: only that week, the boy locked', () => {
    const settlementDispute = {
      ...dispute,
      item: { kind: 'settlement' as const, id: 7 },
      title: '',
      week: { startsAt: week.startsAt, endsAt: week.endsAt },
      value: { level: 'lower' as const, deducted: 50 },
    }
    const s: FixStart = { mode: 'week', takerId: 3, settlementId: 7, dispute: settlementDispute }
    const html = view(s)
    expect(pill(html, 'Mladší')).toMatch(/ disabled=""/)
    expect(html.match(/Celkem 60 · odečteno 50/g)).toHaveLength(1)
  })
})
