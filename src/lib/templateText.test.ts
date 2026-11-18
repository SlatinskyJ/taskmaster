import { describe, expect, it } from 'vitest'
import type { TemplateView } from '~/server/templates/templates'
import { describeTemplate, templateDetail } from './templateText'

type Def = Pick<TemplateView, 'schedule' | 'deadline'>
const deadline = (dayOffset: number, due: string, graceMinutes: number) => ({
  dayOffset,
  due,
  graceMinutes,
})

describe('describeTemplate', () => {
  it.each<[string, Def, string]>([
    [
      'full',
      { schedule: { days: [2, 5], time: '18:00' }, deadline: deadline(1, '07:00', 120) },
      'Út, Pá v 18:00 · do dalšího dne 7:00 (+2 h)',
    ],
    ['no time', { schedule: { days: [2, 5], time: null }, deadline: null }, 'Út, Pá'],
    ['on demand', { schedule: null, deadline: null }, 'Jen na požádání'],
    [
      'Monday first, Sunday last',
      { schedule: { days: [0, 1, 6], time: '06:05' }, deadline: null },
      'Po, So, Ne v 6:05',
    ],
    [
      'every day, long',
      {
        schedule: { days: [0, 1, 2, 3, 4, 5, 6], time: '18:00' },
        deadline: deadline(1, '07:00', 120),
      },
      'Po, Út, St, Čt, Pá, So, Ne v 18:00 · do dalšího dne 7:00 (+2 h)',
    ],
    [
      'same day, no grace',
      { schedule: { days: [2], time: '18:00' }, deadline: deadline(0, '21:30', 0) },
      'Út v 18:00 · do 21:30',
    ],
    [
      'three days later, 90 min grace',
      { schedule: null, deadline: deadline(3, '07:45', 90) },
      'Jen na požádání · do 7:45 za 3 dny (+1,5 h)',
    ],
  ])('%s', (_, def, text) => {
    expect(describeTemplate(def)).toBe(text)
  })
})

describe('templateDetail', () => {
  const base = {
    schedule: { days: [2], time: '18:00' },
    deadline: null,
    approvedBy: [],
  } satisfies Partial<TemplateView>

  it('approval on', () => {
    expect(templateDetail({ ...base, approvalRequired: true, status: 'active' })).toBe(
      'Út v 18:00 · schvaluje rodič',
    )
  })

  it('approval off', () => {
    expect(templateDetail({ ...base, approvalRequired: false, status: 'active' })).toBe(
      'Út v 18:00 · bez schvalování',
    )
  })

  it('proposed: who agreed so far', () => {
    expect(
      templateDetail({ ...base, approvalRequired: true, status: 'proposed', approvedBy: ['Táta'] }),
    ).toBe('Út v 18:00 · schvaluje rodič · Souhlasí: Táta')
  })

  it('active: no agreers shown even if passed', () => {
    expect(
      templateDetail({ ...base, approvalRequired: true, status: 'active', approvedBy: ['Táta'] }),
    ).not.toContain('Souhlasí')
  })
})
