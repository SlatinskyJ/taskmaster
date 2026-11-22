import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ButtonModule from '~/components/ui/button'
import { cs } from '~/lib/strings'
import { selfLogFn } from '~/server/instances/functions'
import { LogConfirm, LogTiles } from './LogTiles'

// Zapsat (#38): the tiles and the confirm Dialog, rendered statically. The Dialog renders inline
// when open; Button and the tiles record their click handlers so a test can press them.
const ui = vi.hoisted(() => ({
  busy: null as string | null,
  run: vi.fn(),
  pressed: new Map<string, { onClick?: (e: unknown) => void; disabled?: boolean }>(),
  onOpenChange: undefined as ((open: boolean) => void) | undefined,
}))
vi.mock('~/components/tasks/useTaskAction', () => ({
  useTaskAction: () => ({ busy: ui.busy, run: ui.run }),
}))
vi.mock('~/components/ui/button', async (original) => {
  const real = await original<typeof ButtonModule>()
  return {
    ...real,
    Button: (props: Parameters<typeof real.Button>[0]) => {
      const name = typeof props.children === 'string' ? props.children : props['aria-label']
      if (name !== undefined) {
        ui.pressed.set(name, {
          onClick: props.onClick as ((e: unknown) => void) | undefined,
          disabled: props.disabled,
        })
      }
      return real.Button(props)
    },
  }
})
vi.mock('~/components/ui/dialog', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean
      onOpenChange?: (open: boolean) => void
      children?: ReactNode
    }) => {
      ui.onOpenChange = onOpenChange
      return open ? <div data-dialog>{children}</div> : null
    },
    DialogContent: Pass,
    DialogHeader: Pass,
    DialogFooter: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
    DialogClose: Pass,
  }
})
vi.mock('~/server/instances/functions', () => ({ selfLogFn: vi.fn() }))

const tiles = [
  { id: 2, title: 'Cvičit na klavír', score: 2, onBoard: false },
  { id: 1, title: 'Vyndat myčku', score: 3, onBoard: false },
]

type Run = [
  string,
  () => unknown,
  (r: { ok: true; id: number; score: number }) => string,
  { confetti?: unknown; float?: number },
]
const lastRun = () => ui.run.mock.calls.at(-1) as Run

beforeEach(() => {
  ui.busy = null
  ui.run.mockReset()
  ui.pressed.clear()
  ui.onOpenChange = undefined
  vi.mocked(selfLogFn).mockReset()
})

describe('LogTiles', () => {
  it('a tile per chore in the order the server sends, each with its points', () => {
    const html = renderToStaticMarkup(<LogTiles templates={tiles} onPick={vi.fn()} />)
    expect(html.indexOf('Cvičit na klavír')).toBeLessThan(html.indexOf('Vyndat myčku'))
    expect(html).toContain('min-h-tap')
    expect(html).toContain('grid-cols-2')
  })

  it('tapping a tile picks that chore', () => {
    const onPick = vi.fn()
    renderToStaticMarkup(<LogTiles templates={tiles} onPick={onPick} />)
    ui.pressed.get(cs.log.tileLabel('Vyndat myčku', 3))?.onClick?.({})
    expect(onPick).toHaveBeenCalledWith(tiles[1])
  })

  it('a chore already on the board is a disabled tile that says so (Jakub 2026-11-22)', () => {
    const onPick = vi.fn()
    const html = renderToStaticMarkup(
      <LogTiles
        templates={[{ ...tiles[1], onBoard: true } as (typeof tiles)[number]]}
        onPick={onPick}
      />,
    )
    expect(html).toContain(cs.log.onBoard)
    const tile = ui.pressed.get(cs.log.tileOnBoardLabel('Vyndat myčku'))
    expect(tile?.disabled).toBe(true)
    tile?.onClick?.({})
    expect(onPick).not.toHaveBeenCalled()
  })

  it('says so when there is nothing to log', () => {
    expect(renderToStaticMarkup(<LogTiles templates={[]} onPick={vi.fn()} />)).toContain(
      cs.log.empty,
    )
  })
})

describe('LogConfirm', () => {
  const tile = { id: 1, title: 'Vyndat myčku', score: 3, onBoard: false }
  const ALL = ['now', 'this_morning', 'yesterday'] as const

  it('asks first, with the chore and its points', () => {
    const html = renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={vi.fn()} />,
    )
    expect(html).toContain(cs.log.confirmTitle)
    expect(html).toContain('Vyndat myčku za 3 b. Rodič to ještě schválí.')
    expect(
      renderToStaticMarkup(
        <LogConfirm tile={null} when="now" choices={ALL} onWhen={vi.fn()} onClose={vi.fn()} />,
      ),
    ).toBe('')
  })

  it('Zapsat sends the chore and the score it showed, with confetti and the float', async () => {
    ui.run.mockResolvedValue(true)
    const onClose = vi.fn()
    renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={onClose} />,
    )
    const el = { tag: 'button' }
    ui.pressed.get(cs.log.confirm)?.onClick?.({ currentTarget: el })
    const [key, fn, success, opts] = lastRun()
    expect(key).toBe('log-1')
    expect(opts).toEqual({ confetti: el, float: 3 })
    void fn()
    expect(selfLogFn).toHaveBeenCalledWith({ data: { templateId: 1, score: 3, when: 'now' } })
    expect(success({ ok: true, id: 9, score: 3 })).toBe(cs.log.toast)
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('a double tap sends once', () => {
    ui.run.mockReturnValue(new Promise(() => undefined))
    renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={vi.fn()} />,
    )
    const press = ui.pressed.get(cs.log.confirm)?.onClick
    press?.({ currentTarget: null })
    press?.({ currentTarget: null })
    expect(ui.run).toHaveBeenCalledTimes(1)
  })

  it('a refusal keeps the Dialog open (the hook shows the error and reloads)', async () => {
    ui.run.mockResolvedValue(false)
    const onClose = vi.fn()
    renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={onClose} />,
    )
    ui.pressed.get(cs.log.confirm)?.onClick?.({ currentTarget: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a second chore logs in the same visit after the first one went through', async () => {
    ui.run.mockResolvedValue(true)
    renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={vi.fn()} />,
    )
    const press = ui.pressed.get(cs.log.confirm)?.onClick
    press?.({ currentTarget: null })
    await vi.waitFor(() => {
      expect(ui.run).toHaveBeenCalledTimes(1)
    })
    await Promise.resolve()
    await Promise.resolve()
    press?.({ currentTarget: null })
    expect(ui.run).toHaveBeenCalledTimes(2)
  })

  it('a retry after a refusal sends again', async () => {
    ui.run.mockResolvedValue(false)
    renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={vi.fn()} />,
    )
    const press = ui.pressed.get(cs.log.confirm)?.onClick
    press?.({ currentTarget: null })
    await Promise.resolve()
    await Promise.resolve()
    press?.({ currentTarget: null })
    expect(ui.run).toHaveBeenCalledTimes(2)
  })

  it('Zpět, Esc or a tap outside closes without logging', () => {
    const onClose = vi.fn()
    renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={onClose} />,
    )
    ui.onOpenChange?.(true)
    expect(onClose).not.toHaveBeenCalled()
    ui.onOpenChange?.(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(ui.run).not.toHaveBeenCalled()
  })

  it('"Kdy?": a pill per open choice, the picked one pressed; a tap picks it (Jakub 2026-11-22)', () => {
    const onWhen = vi.fn()
    const html = renderToStaticMarkup(
      <LogConfirm tile={tile} when="yesterday" choices={ALL} onWhen={onWhen} onClose={vi.fn()} />,
    )
    expect(html).toContain(cs.log.when.label)
    for (const w of ALL) expect(html).toContain(cs.log.when[w])
    // Only the picked pill is pressed and ringed.
    const pill = (label: string) => new RegExp(`<button[^>]*>${label}</button>`).exec(html)?.[0]
    expect(pill(cs.log.when.yesterday)).toMatch(/aria-pressed="true"/)
    expect(pill(cs.log.when.yesterday)).toContain('ring-accent-strong')
    for (const other of [cs.log.when.now, cs.log.when.this_morning]) {
      expect(pill(other)).toMatch(/aria-pressed="false"/)
      expect(pill(other)).not.toContain('ring-accent-strong')
    }
    ui.pressed.get(cs.log.when.this_morning)?.onClick?.({})
    expect(onWhen).toHaveBeenCalledWith('this_morning')
  })

  it('sends the picked time, and the body says it', () => {
    ui.run.mockResolvedValue(true)
    const html = renderToStaticMarkup(
      <LogConfirm tile={tile} when="yesterday" choices={ALL} onWhen={vi.fn()} onClose={vi.fn()} />,
    )
    expect(html).toContain(cs.log.confirmBody('Vyndat myčku', 3))
    ui.pressed.get(cs.log.confirm)?.onClick?.({ currentTarget: null })
    void lastRun()[1]()
    expect(selfLogFn).toHaveBeenCalledWith({
      data: { templateId: 1, score: 3, when: 'yesterday' },
    })
  })

  it('no pills when "now" is the only choice', () => {
    const html = renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={['now']} onWhen={vi.fn()} onClose={vi.fn()} />,
    )
    expect(html).not.toContain(cs.log.when.label)
  })

  it('the confirm button is enabled when idle', () => {
    renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={vi.fn()} />,
    )
    expect(ui.pressed.get(cs.log.confirm)?.disabled).toBe(false)
  })

  it('the confirm button is disabled while busy', () => {
    ui.busy = 'log-1'
    renderToStaticMarkup(
      <LogConfirm tile={tile} when="now" choices={ALL} onWhen={vi.fn()} onClose={vi.fn()} />,
    )
    expect(ui.pressed.get(cs.log.confirm)?.disabled).toBe(true)
  })
})
