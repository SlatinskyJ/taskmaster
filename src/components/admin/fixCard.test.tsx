import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cs } from '~/lib/strings'
import type { AdminDisputeEntry } from '~/server/disputes/functions'
import { afterFix, draftKey, FixCard, fixStartOf, loadFixable } from './FixCard'

// Opravy bodů on Správa and how a Sporné row opens the fix sheet (#48).

const t = cs.admin.fix
const noop = () => undefined
const entry = (over: Partial<AdminDisputeEntry>): AdminDisputeEntry => ({
  id: 9,
  item: { kind: 'completion', id: 10 },
  title: 'Vysát auto',
  week: null,
  takerName: 'Starší',
  takerId: 3,
  openedByName: 'Starší',
  reason: 'Víc.',
  openedAt: '2026-11-22T10:00:00.000Z',
  value: { score: 22 },
  ...over,
})

describe('fixStartOf', () => {
  it('a settlement dispute opens week mode on that settlement and boy', () => {
    const e = entry({
      item: { kind: 'settlement', id: 7 },
      value: { level: 'lower', deducted: 50 },
    })
    expect(fixStartOf(e)).toEqual({ mode: 'week', takerId: 3, settlementId: 7, dispute: e })
  })

  it("any other dispute opens points mode with the item's boy; a score names none", () => {
    const c = entry({})
    expect(fixStartOf(c)).toEqual({ mode: 'points', takerId: 3, dispute: c })
    const s = entry({ item: { kind: 'task_score', id: 10 }, takerId: null })
    expect(fixStartOf(s)).toEqual({ mode: 'points', takerId: null, dispute: s })
  })
})

describe('drafts', () => {
  it('one reason per dispute, one per direct mode', () => {
    expect(draftKey(fixStartOf(entry({ id: 9 })))).toBe('dispute:9')
    expect(draftKey({ mode: 'points', takerId: null, dispute: null })).toBe('direct:points')
    expect(draftKey({ mode: 'week', takerId: null, settlementId: null, dispute: null })).toBe(
      'direct:week',
    )
  })

  it('a stale row keeps the typed reason; a sent fix clears it', () => {
    const drafts = { 'dispute:9': 'Dlouhý důvod.', 'dispute:5': 'Jiný.' }
    expect(afterFix(drafts, 'dispute:9', { ok: false, message: 'x', reload: true })).toEqual(drafts)
    expect(afterFix(drafts, 'dispute:9', { ok: true })).toEqual({ 'dispute:5': 'Jiný.' })
  })
})

describe('FixCard', () => {
  it('the section with Upravit body and Opravit týden, a tap high', () => {
    const html = renderToStaticMarkup(
      <FixCard failed={false} onAdjust={noop} onCorrect={noop} onRetry={noop} />,
    )
    expect(html).toContain(t.title)
    expect(html).toContain(`>${t.adjust}<`)
    expect(html).toContain(`>${t.correct}<`)
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toContain('min-h-tap')
  })

  it('a failed load: the message and a retry instead of the buttons', () => {
    const html = renderToStaticMarkup(
      <FixCard failed onAdjust={noop} onCorrect={noop} onRetry={noop} />,
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain(t.loadError)
    expect(html).toContain(t.retry)
    expect(html).not.toContain(`>${t.adjust}<`)
  })
})

describe('loadFixable', () => {
  it('passes the answer through; a throw becomes the retry state', async () => {
    await expect(loadFixable(() => Promise.resolve([]))).resolves.toEqual([])
    await expect(
      loadFixable(() => Promise.resolve({ error: 'feature_off' as const })),
    ).resolves.toEqual({
      error: 'feature_off',
    })
    await expect(loadFixable(() => Promise.reject(new Error('net')))).resolves.toEqual({
      error: 'load',
    })
  })
})
