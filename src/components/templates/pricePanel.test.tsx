import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Me } from '~/components/tasks/taskView'
import { cs } from '~/lib/strings'
import type { TemplateView } from '~/server/templates/functions'
import { TemplatePricePanel } from './TemplatePricePanel'

// What the template price page lets each person do (#138), rendered statically. The action hook
// and the server functions don't run in a static render, so they are stubbed.
vi.mock('~/components/tasks/useTaskAction', () => ({
  useTaskAction: () => ({ busy: null, run: vi.fn() }),
}))
vi.mock('./priceCalls', () => ({ callPrice: vi.fn(), PRICE_CALLS: {} }))
vi.mock('~/server/templates/functions', () => ({}))

const TATA: Me = { id: 2, role: 'giver' }
const STARSI: Me = { id: 4, role: 'taker' }
const MLADSI: Me = { id: 5, role: 'taker' }

const base: TemplateView = {
  id: 7,
  title: 'Vyndat myčku',
  status: 'active',
  score: 3,
  approvalRequired: true,
  createdByName: 'Táta',
  approvedBy: [],
  schedule: null,
  deadline: null,
  bidding: null,
  change: null,
}
const demo: TemplateView = {
  ...base,
  change: {
    offer: { score: 4, byName: 'Táta' },
    bids: [{ takerId: MLADSI.id, name: 'Mladší', score: 5 }],
    lowest: 5,
  },
}

/** The stepper's − button. */
const stepper = `aria-label="${cs.tasks.less}"`

const html = (t: TemplateView, me: Me) =>
  renderToStaticMarkup(<TemplatePricePanel template={t} me={me} />)

describe('TemplatePricePanel', () => {
  it('a parent accepts the lowest bid or makes a new offer', () => {
    const out = html(demo, TATA)
    expect(out).toContain('Přijmout 5 (Mladší)')
    expect(out).toContain('Nové úkoly budou za tolik bodů.')
    expect(out).toContain('Nová nabídka')
    expect(out).toContain(stepper)
  })

  it('a brother accepts the offer or wants another price', () => {
    const out = html(demo, STARSI)
    expect(out).toContain('Přijmout 4')
    expect(out).toContain('Chci jinou cenu')
    expect(out).not.toContain('Tvoje nabídka')
  })

  it('a brother with a bid sees it', () => {
    expect(html(demo, MLADSI)).toContain('Tvoje nabídka 5')
  })

  it('no change yet: both may start one, nothing to accept', () => {
    for (const me of [STARSI, TATA]) {
      const out = html(base, me)
      expect(out).toContain(stepper)
      expect(out).toContain('Nabídnout')
      expect(out).not.toContain('Přijmout')
    }
  })

  it('a proposed template renders nothing', () => {
    expect(html({ ...base, status: 'proposed' }, TATA)).toBe('')
  })
})
