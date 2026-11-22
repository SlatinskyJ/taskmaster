import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ButtonModule from '~/components/ui/button'
import { DEFAULT_PERIOD_DEFAULTS } from '~/domain'
import { cs } from '~/lib/strings'
import { proposeDefaultsFn } from '~/server/periods/functions'
import { DefaultsProposalView } from './DefaultsProposalScreen'
import type { DefaultsProposalViewProps } from './DefaultsProposalScreen'
import { defaultsProposal, proposalsView, STARSI, TATA } from './fixtures'
import { proposeDefaults } from './proposalCalls'

// Výchozí týden for parents (#43, UI doc §7.2 GDefaults), rendered statically.
const pressed = vi.hoisted(() => ({
  list: [] as { name: string; onClick?: () => void; disabled?: boolean }[],
}))
vi.mock('~/components/ui/button', async (original) => {
  const real = await original<typeof ButtonModule>()
  return {
    ...real,
    Button: (props: Parameters<typeof real.Button>[0]) => {
      const name = typeof props.children === 'string' ? props.children : props['aria-label']
      if (name !== undefined) {
        pressed.list.push({
          name,
          onClick: props.onClick as (() => void) | undefined,
          disabled: props.disabled,
        })
      }
      return real.Button(props)
    },
  }
})
vi.mock('~/server/periods/functions', () => ({
  approveProposalFn: vi.fn(),
  rejectProposalFn: vi.fn(),
  withdrawProposalFn: vi.fn(),
  proposePeriodFn: vi.fn(),
  proposeDefaultsFn: vi.fn(() => Promise.resolve({ ok: true, status: 'pending' })),
}))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: vi.fn() }) }))

const t = cs.proposals
const D = DEFAULT_PERIOD_DEFAULTS
const noop = () => undefined

function render(over: Partial<DefaultsProposalViewProps> = {}) {
  pressed.list = []
  return renderToStaticMarkup(
    <DefaultsProposalView
      view={proposalsView()}
      me={TATA}
      form={D}
      busy={null}
      error={null}
      onChange={noop}
      onPropose={noop}
      onAct={noop}
      {...over}
    />,
  )
}
const button = (name: string) => pressed.list.find((b) => b.name === name)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Výchozí týden (parents)', () => {
  it('the unchanged form: Navrhnout všem is disabled; the hint says it is a proposal', () => {
    const html = render()
    expect(button(t.proposeAll)?.disabled).toBe(true)
    expect(html).toContain(t.defaultsHint)
    expect(html).not.toContain(cs.admin.save)
  })

  it('a change enables it; pressing it proposes', () => {
    const onPropose = vi.fn()
    render({ form: { ...D, lengthDays: 14 }, onPropose })
    expect(button(t.proposeAll)?.disabled).toBe(false)
    button(t.proposeAll)?.onClick?.()
    expect(onPropose).toHaveBeenCalledTimes(1)
  })

  it('proposeDefaults sends the form’s values', async () => {
    const d = { ...D, lengthDays: 14, levels: { lower: 60, upper: 120 } }
    await proposeDefaults(d)
    expect(proposeDefaultsFn).toHaveBeenCalledExactlyOnceWith({ data: d })
  })

  it('a refusal shows its Czech text', () => {
    expect(render({ error: t.errors.pending })).toContain(t.errors.pending)
  })

  it('a pending proposal: its card, no form', () => {
    const html = render({ view: proposalsView({ defaults: defaultsProposal() }) })
    expect(html).toContain(t.defaultsSection)
    expect(html).toContain(t.proposedBy('Táta'))
    expect(html).toContain('<s class="text-muted">7 dní</s>')
    expect(html).toContain('14 dní')
    expect(button(t.proposeAll)).toBeUndefined()
    expect(pressed.list.map((b) => b.name)).toEqual([t.withdraw])
  })

  it('a taker waiting on it can answer', () => {
    render({ view: proposalsView({ defaults: defaultsProposal() }), me: STARSI })
    expect(pressed.list.map((b) => b.name)).toEqual([t.approve, t.reject])
  })

  it('the form shows what is stored now (Nyní …)', () => {
    expect(render({ form: { ...D, lengthDays: 21 } })).toContain(
      'Nyní: 7 dní · konec neděle 23:59 · spodní hranice 50, horní 100',
    )
  })

  it('while proposing, the button says Posílám… and is disabled', () => {
    render({ form: { ...D, lengthDays: 14 }, busy: 'propose' })
    expect(button(t.sending)?.disabled).toBe(true)
    expect(button(t.proposeAll)).toBeUndefined()
  })
})
