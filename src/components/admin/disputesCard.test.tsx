import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { adminDisputeLines } from '~/components/disputes/disputeProps'
import { cs } from '~/lib/strings'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import { closesDialog, DISMISS_START, DismissForm, dismissReducer } from './DismissDialog'
import { dismissInput, DisputesCard, loadAdminDisputes } from './DisputesCard'

// Sporné on Správa (#47): the rows, the empty and error states, and the keep dialog's body.
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
  openedByName: 'Starší',
  reason,
  openedAt: '2026-11-22T10:00:00.000Z',
  value: { score: 30 },
}
const noop = () => undefined

describe('DisputesCard', () => {
  it('a row: the disputed stripe, the lines, the reason in its own block and Ponechat', () => {
    const html = renderToStaticMarkup(
      <DisputesCard data={[entry, { ...entry, id: 6 }]} onKeep={noop} onRetry={noop} />,
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

  it('empty: one friendly line', () => {
    const html = renderToStaticMarkup(<DisputesCard data={[]} onKeep={noop} onRetry={noop} />)
    expect(html).toContain(t.title(0))
    expect(html).toContain(t.empty)
  })

  it('a failed load: the message and a retry', () => {
    const html = renderToStaticMarkup(
      <DisputesCard data={{ error: 'load' }} onKeep={noop} onRetry={noop} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain(t.loadError)
    expect(html).toContain(t.retry)
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
    expect(html).toMatch(/maxLength="200"/i)
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
