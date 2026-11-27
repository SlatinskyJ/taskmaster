import { describe, expect, it } from 'vitest'
import { ALL_FEATURES, FEATURE_KEYS, NO_FEATURES } from './features'

// Each key is written out by hand on purpose: a test built from FEATURE_KEYS would not notice a
// switch dropped from the list, and a loop over the object would not notice a flipped value (#292).
describe('launch switch defaults', () => {
  it('NO_FEATURES: every switch off, exactly the keys of FEATURE_KEYS', () => {
    expect(NO_FEATURES).toStrictEqual({
      recurring: false,
      log: false,
      week: false,
      meeting: false,
      periodProposals: false,
      disputes: false,
      settleLastDay: false,
      passwordChange: false,
      bidRefusals: false,
      approveAnywhere: false,
      reopenBidding: false,
      choreBidding: false,
      openRows: false,
      descriptions: false,
      weekPlan: false,
      suggestions: false,
      liveChanges: false,
    })
    expect(Object.keys(NO_FEATURES)).toEqual([...FEATURE_KEYS])
  })

  it('ALL_FEATURES: every switch on, exactly the keys of FEATURE_KEYS', () => {
    expect(ALL_FEATURES).toStrictEqual({
      recurring: true,
      log: true,
      week: true,
      meeting: true,
      periodProposals: true,
      disputes: true,
      settleLastDay: true,
      passwordChange: true,
      bidRefusals: true,
      approveAnywhere: true,
      reopenBidding: true,
      choreBidding: true,
      openRows: true,
      descriptions: true,
      weekPlan: true,
      suggestions: true,
      liveChanges: true,
    })
    expect(Object.keys(ALL_FEATURES)).toEqual([...FEATURE_KEYS])
  })

  it('FEATURE_KEYS: the seed migration order', () => {
    expect(FEATURE_KEYS).toEqual([
      'recurring',
      'log',
      'week',
      'meeting',
      'periodProposals',
      'disputes',
      'settleLastDay',
      'passwordChange',
      'bidRefusals',
      'approveAnywhere',
      'reopenBidding',
      'choreBidding',
      'openRows',
      'descriptions',
      'weekPlan',
      'suggestions',
      'liveChanges',
    ])
  })
})
