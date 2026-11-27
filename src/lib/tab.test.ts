import { describe, expect, it } from 'vitest'
import { tabId } from './tab'

describe('tabId (#299)', () => {
  it('is one random id per page load', () => {
    expect(tabId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(tabId()).toBe(tabId())
  })
})
