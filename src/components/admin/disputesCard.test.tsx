import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { adminDisputeLines } from '~/components/disputes/disputeProps'
import { cs } from '~/lib/strings'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import { closesDialog, DISMISS_START, DismissForm, dismissReducer } from './DismissDialog'
import { dismissInput, DisputesCard, loadAdminDisputes } from './DisputesCard'

// Sporné on Správa (#47): the rows, the empty and error states, and the keep dialog's body.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params: Record<string, string>
    children: ReactNode
    'aria-label'?: string
    className?: string
  }) => (
    <a
      href={to.replace(/\$(\w+)/g, (_, k: string) => params[k] ?? '')}
      aria-label={rest['aria-label']}
      className={rest.className}
    >
      {children}
    </a>
  ),
}))
vi.mock('~/components/ui/dialog', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Dialog: Pass,
    DialogContent: Pass,
    DialogHeader: Pass,
    DialogFooter: Pass,
    DialogTitle: Pass,
    DialogDescription: Pass,
    DialogClose: Pass,
  }
})

const t = cs.admin.disputes
const reason = 'Vysával jsem i kufr a koberečky, to je mnohem víc práce než obyčejně. '.repeat(3)
const entry: AdminDisputeEntry = {
  id: 5,
  item: { kind: 'task_score', id: 10 },
  title: 'Vyluxovat celý obývák a chodbu',
  week: null,
  takerName: null,
  takerId: null,
  openedByName: 'Starší',
  reason,
  openedAt: '2026-11-22T10:00:00.000Z',
  value: { score: 30 },
  page: null,
}
const noop = () => undefined

describe('DisputesCard', () => {
  it('a row: the disputed stripe, the lines, the reason in its own block and Ponechat', () => {
    const html = renderToStaticMarkup(
      <DisputesCard
        data={[entry, { ...entry, id: 6 }]}
        onKeep={noop}
        onFix={noop}
        onRetry={noop}
      />,
    )
    expect(html).toContain(t.title(2))
    expect(html).toContain('border-l-state-disputed')
    expect(html).toContain('Body za úkol')
    expect(html).toContain('Vyluxovat celý obývák a chodbu · 30 bodů')
    expect(html).toContain('Starší rozporuje · 22. 11.')
    expect(html).toMatch(/<blockquote[^>]*>Vysával jsem/)
    expect(html).toContain(
      `aria-label="${t.keepFor('Body za úkol', 'Vyluxovat celý obývák a chodbu')}"`,
    )
    expect(html).toContain('min-h-tap')
    expect(html).not.toContain('truncate')
  })

  it('a row has Opravit beside Ponechat, named for its item (#48)', () => {
    const html = renderToStaticMarkup(
      <DisputesCard data={[entry]} onKeep={noop} onFix={noop} onRetry={noop} />,
    )
    expect(html).toContain(
      `aria-label="${t.fixFor('Body za úkol', 'Vyluxovat celý obývák a chodbu')}"`,
    )
    expect(html.indexOf(`>${t.keep}<`)).toBeLessThan(html.indexOf(`>${t.fix}<`))
  })

  it('empty: one friendly line', () => {
    const html = renderToStaticMarkup(
      <DisputesCard data={[]} onKeep={noop} onFix={noop} onRetry={noop} />,
    )
    expect(html).toContain(t.title(0))
    expect(html).toContain(t.empty)
  })

  it('a failed load: the message and a retry', () => {
    const html = renderToStaticMarkup(
      <DisputesCard data={{ error: 'load' }} onKeep={noop} onFix={noop} onRetry={noop} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain(t.loadError)
    expect(html).toContain(t.retry)
  })
})

describe('a Sporné card opens its item (#222)', () => {
  const card = (e: AdminDisputeEntry) =>
    renderToStaticMarkup(<DisputesCard data={[e]} onKeep={noop} onFix={noop} onRetry={noop} />)

  it('no page: the card exactly as before, no link', () => {
    expect(card(entry)).toMatchInlineSnapshot(
      `"<section class="mb-3.5 grid gap-2" aria-labelledby="admin-disputes-label"><h2 class="text-xs font-extrabold tracking-[.07em] text-muted uppercase" id="admin-disputes-label">Sporné (1)</h2><ul class="grid gap-2"><li data-admin-dispute="5" class="grid min-w-0 gap-1 rounded-card border-l-4 border-l-state-disputed bg-surface py-2.5 pr-2.5 pl-3 shadow-sticker"><span class="text-meta font-bold break-words text-muted">Body za úkol</span><span class="text-row font-bold break-words">Vyluxovat celý obývák a chodbu · 30 bodů</span><span class="text-meta break-words text-muted">Starší rozporuje · 22. 11.</span><blockquote class="rounded-button bg-track/40 px-3 py-2 break-words">Vysával jsem i kufr a koberečky, to je mnohem víc práce než obyčejně. Vysával jsem i kufr a koberečky, to je mnohem víc práce než obyčejně. Vysával jsem i kufr a koberečky, to je mnohem víc práce než obyčejně. </blockquote><div class="flex flex-wrap justify-end gap-2"><button data-slot="button" class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-button font-display font-semibold whitespace-nowrap transition-[transform,background-color,box-shadow] select-none active:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:shrink-0 [&amp;_svg:not([class*=&quot;size-&quot;])]:size-5 border-2 border-track bg-surface text-ink shadow-sticker min-h-tap px-4 text-row" type="button" aria-label="Ponechat: Body za úkol – Vyluxovat celý obývák a chodbu">Ponechat</button><button data-slot="button" class="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-button font-display font-semibold whitespace-nowrap transition-[transform,background-color,box-shadow] select-none active:translate-y-px active:shadow-none disabled:pointer-events-none disabled:opacity-50 [&amp;_svg]:pointer-events-none [&amp;_svg]:shrink-0 [&amp;_svg:not([class*=&quot;size-&quot;])]:size-5 bg-accent-strong text-on-accent-strong shadow-sticker min-h-tap px-4 text-row" type="button" aria-label="Opravit: Body za úkol – Vyluxovat celý obývák a chodbu">Opravit</button></div></li></ul></section>"`,
    )
  })

  it('a task: one link to /ukol/7 over the card, named for the item; the buttons above it', () => {
    const html = card({ ...entry, page: { kind: 'task', id: 7 } })
    expect(html.match(/<a /g)).toHaveLength(1)
    expect(html).toMatch(
      /<li[^>]*class="[^"]*\brelative\b[^"]*"[^>]*><span[^>]*>Body za úkol<\/span><span class="text-row font-bold break-words"><a href="\/ukol\/7" aria-label="([^"]*)" class="[^"]*after:absolute after:inset-0[^"]*">Vyluxovat celý obývák a chodbu · 30 bodů<\/a><\/span>/,
    )
    expect(html).toContain(
      `aria-label="${t.openFor('Body za úkol', 'Vyluxovat celý obývák a chodbu')}"`,
    )
    expect(t.openFor('Body za úkol', 'Umýt okna')).toBe('Otevřít: Body za úkol – Umýt okna')
    expect(html).toMatch(/<div class="[^"]*\brelative z-10\b[^"]*"><button[^>]*>Ponechat/)
  })

  it('a chore: the link goes to /sablona/4', () => {
    const html = card({
      ...entry,
      item: { kind: 'template_score', id: 4 },
      page: { kind: 'template', id: 4 },
    })
    expect(html).toContain('<a href="/sablona/4"')
  })
})

describe('dismissInput', () => {
  it('sends the id and the value the row showed', () => {
    expect(dismissInput(entry, 'Sedí.')).toEqual({ id: 5, value: { score: 30 }, note: 'Sedí.' })
  })
})

describe('loadAdminDisputes', () => {
  it('a thrown fetch becomes the retry state; feature_off passes through', async () => {
    await expect(loadAdminDisputes(() => Promise.reject(new Error('net')))).resolves.toEqual({
      error: 'load',
    })
    await expect(
      loadAdminDisputes(() => Promise.resolve({ error: 'feature_off' as const })),
    ).resolves.toEqual({ error: 'feature_off' })
    await expect(loadAdminDisputes(() => Promise.resolve([entry]))).resolves.toEqual([entry])
  })
})

describe('DismissForm', () => {
  const form = (over: Partial<Parameters<typeof DismissForm>[0]> = {}) =>
    renderToStaticMarkup(
      <DismissForm
        lines={adminDisputeLines(entry)}
        note=""
        busy={false}
        error={null}
        onNote={noop}
        onConfirm={noop}
        {...over}
      />,
    )

  it('title, what it does, the note field with its limit, and cancel', () => {
    const html = form()
    expect(html).toContain(t.dialogTitle)
    expect(html).toContain(t.dialogText)
    expect(html).toContain(t.noteLabel)
    expect(html).toContain(t.noteHint)
    expect(html).toMatch(/maxLength="1000"/i)
    expect(html).toContain(cs.admin.cancel)
  })

  it('the confirm button is disabled while the note is only spaces', () => {
    expect(form({ note: '   ' })).toMatch(/type="submit"[^>]*\sdisabled=""/)
    expect(form({ note: 'Sedí.' })).not.toMatch(/type="submit"[^>]*\sdisabled=""/)
  })

  it('busy shows Ukládám…', () => {
    expect(form({ note: 'Sedí.', busy: true })).toContain(t.saving)
  })

  it('an error shows as an alert and keeps the note', () => {
    const html = form({ note: 'Sedí to.', error: t.errors.note_required })
    expect(html).toMatch(/role="alert"[^>]*>Napiš poznámku\./)
    expect(html).toContain('Sedí to.')
  })
})

describe('dismissReducer', () => {
  const typed = dismissReducer(DISMISS_START, { type: 'note', note: 'Sedí.' })
  const sent = dismissReducer(typed, { type: 'send' })

  it('sending is busy; an answer ends it', () => {
    expect(sent).toEqual({ note: 'Sedí.', busy: true, error: null })
  })

  it('a refusal that leaves the row valid keeps the note and shows why', () => {
    const r = dismissReducer(sent, {
      type: 'answer',
      outcome: { ok: false, message: t.errors.note_required, reload: false },
    })
    expect(r).toEqual({ note: 'Sedí.', busy: false, error: t.errors.note_required })
    expect(dismissReducer(r, { type: 'note', note: 'Sedí to.' }).error).toBeNull()
  })

  it('kept or stale: the dialog closes and starts empty', () => {
    for (const outcome of [
      { ok: true as const },
      { ok: false as const, message: t.errors.value_changed, reload: true },
    ]) {
      expect(closesDialog(outcome)).toBe(true)
      expect(dismissReducer(sent, { type: 'answer', outcome })).toEqual(DISMISS_START)
    }
    expect(closesDialog({ ok: false, message: 'x', reload: false })).toBe(false)
  })

  it('closing forgets a typed note, so the next row starts empty', () => {
    expect(dismissReducer(typed, { type: 'close' })).toEqual(DISMISS_START)
  })
})
