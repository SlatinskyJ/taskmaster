import { describe, expect, it } from 'vitest'
import { dialogPlacement } from './dialog'

// A dialog sits in the part of the screen the phone keyboard leaves (#215). Without the
// tracker's variables (no visualViewport, first paint) the fallbacks keep today's centring.

describe('dialogPlacement (#215)', () => {
  it('centres in the visual viewport, falling back to the whole screen', () => {
    expect(dialogPlacement).toContain('top-[calc(var(--vv-top,0px)+var(--vv-height,100dvh)/2)]')
  })

  it('never grows past the visible part; scrolls inside instead', () => {
    expect(dialogPlacement).toContain('max-h-[calc(var(--vv-height,100dvh)-2rem)]')
    expect(dialogPlacement).toContain('overflow-y-auto')
  })
})
