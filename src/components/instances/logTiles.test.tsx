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
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div data-dialog>{children}</div> : null,
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
  { id: 2, title: 'Cvičit na klavír', score: 2 },
  { id: 1, title: 'Vyndat myčku', score: 3 },
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

  it('says so when there is nothing to log', () => {
    expect(renderToStaticMarkup(<LogTiles templates={[]} onPick={vi.fn()} />)).toContain(
      cs.log.empty,
    )
  })
})

describe('LogConfirm', () => {
  const tile = { id: 1, title: 'Vyndat myčku', score: 3 }

  it('asks first, with the chore and its points', () => {
    const html = renderToStaticMarkup(<LogConfirm tile={tile} onClose={vi.fn()} />)
    expect(html).toContain(cs.log.confirmTitle)
    expect(html).toContain('Vyndat myčku za 3 b. Rodič to ještě schválí.')
    expect(renderToStaticMarkup(<LogConfirm tile={null} onClose={vi.fn()} />)).toBe('')
  })

  it('Zapsat sends the chore and the score it showed, with confetti and the float', async () => {
    ui.run.mockResolvedValue(true)
    const onClose = vi.fn()
    renderToStaticMarkup(<LogConfirm tile={tile} onClose={onClose} />)
    const el = { tag: 'button' }
    ui.pressed.get(cs.log.confirm)?.onClick?.({ currentTarget: el })
    const [key, fn, success, opts] = lastRun()
    expect(key).toBe('log-1')
    expect(opts).toEqual({ confetti: el, float: 3 })
    void fn()
    expect(selfLogFn).toHaveBeenCalledWith({ data: { templateId: 1, score: 3 } })
    expect(success({ ok: true, id: 9, score: 3 })).toBe(cs.log.toast)
    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('a double tap sends once', () => {
    ui.run.mockReturnValue(new Promise(() => undefined))
    renderToStaticMarkup(<LogConfirm tile={tile} onClose={vi.fn()} />)
    const press = ui.pressed.get(cs.log.confirm)?.onClick
    press?.({ currentTarget: null })
    press?.({ currentTarget: null })
    expect(ui.run).toHaveBeenCalledTimes(1)
  })

  it('a refusal keeps the Dialog open (the hook shows the error and reloads)', async () => {
    ui.run.mockResolvedValue(false)
    const onClose = vi.fn()
    renderToStaticMarkup(<LogConfirm tile={tile} onClose={onClose} />)
    ui.pressed.get(cs.log.confirm)?.onClick?.({ currentTarget: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('the confirm button is disabled while busy', () => {
    ui.busy = 'log-1'
    renderToStaticMarkup(<LogConfirm tile={tile} onClose={vi.fn()} />)
    expect(ui.pressed.get(cs.log.confirm)?.disabled).toBe(true)
  })
})
