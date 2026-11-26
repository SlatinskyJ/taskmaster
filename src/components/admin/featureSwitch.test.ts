import { describe, expect, it } from 'vitest'
import { FEATURE_KEYS, NO_FEATURES } from '~/lib/features'
import { cs } from '~/lib/strings'
import { confirmCopy, loadSwitches, switchRows } from './featureSwitch'

// Funkce on Správa (#296): one row per launch switch the code knows, and the confirm's copy.

const t = cs.admin.features

describe('switchRows', () => {
  it('one row per switch, in FEATURE_KEYS order, all off with every switch off', () => {
    const rows = switchRows(NO_FEATURES)
    expect(rows).toHaveLength(FEATURE_KEYS.length)
    expect(rows.map((r) => r.key)).toEqual([...FEATURE_KEYS])
    expect(rows.every((r) => !r.on)).toBe(true)
  })

  it('shows the switch that is on as on, and only that one', () => {
    const rows = switchRows({ ...NO_FEATURES, log: true })
    expect(rows.filter((r) => r.on).map((r) => r.key)).toEqual(['log'])
  })

  it('every row has a Czech name and a hint', () => {
    for (const r of switchRows(NO_FEATURES)) {
      expect(r.name.trim()).not.toBe('')
      expect(r.hint.trim()).not.toBe('')
      expect(r.name).toBe(t.names[r.key].name)
    }
  })
})

describe('confirmCopy', () => {
  it('turning Plán týdne off warns about the 15 minutes', () => {
    const c = confirmCopy('weekPlan', false)
    expect(c.title).toBe(t.turnOffTitle(t.names.weekPlan.name))
    expect(c.body).toContain(t.weekPlanOff)
    expect(c.body).toContain(t.forFamily)
    expect(c.confirm).toBe(t.confirmOff)
  })

  it('turning Plán týdne on, or another switch off, does not', () => {
    const on = confirmCopy('weekPlan', true)
    expect(on.body).not.toContain(t.weekPlanOff)
    expect(on.title).toBe(t.turnOnTitle(t.names.weekPlan.name))
    expect(on.confirm).toBe(t.confirmOn)
    expect(confirmCopy('log', false).body).not.toContain(t.weekPlanOff)
    expect(confirmCopy('log', false).body).toContain(t.forFamily)
  })
})

describe('loadSwitches', () => {
  it('passes the switches through; a failed read becomes the retry state', async () => {
    await expect(loadSwitches(() => Promise.resolve(NO_FEATURES))).resolves.toBe(NO_FEATURES)
    await expect(loadSwitches(() => Promise.reject(new Error('net')))).resolves.toEqual({
      error: 'failed',
    })
  })
})
