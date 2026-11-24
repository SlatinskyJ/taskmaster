// The part of the screen a person can see: on a phone the keyboard covers the rest (#215).
// Mirrors window.visualViewport into `--vv-top` and `--vv-height` on <html>. The reader is
// `dialogPlacement` in src/components/ui/dialog.tsx, which centres dialogs in that box.

interface ViewportWindow {
  visualViewport: Pick<
    VisualViewport,
    'offsetTop' | 'height' | 'addEventListener' | 'removeEventListener'
  > | null
  document: {
    documentElement: { style: Pick<CSSStyleDeclaration, 'setProperty'> }
    activeElement: Element | null
  }
}

const TYPED = new Set(['INPUT', 'TEXTAREA'])

/**
 * Starts mirroring; returns the cleanup. Without a visual viewport it does nothing. When the
 * visible part shrinks (the keyboard opens) the field being typed into is scrolled back into
 * view: the browser scrolled it there on focus, before the keyboard took its space.
 */
export function trackVisualViewport(win: ViewportWindow): () => void {
  const vv = win.visualViewport
  if (!vv) return () => undefined
  const style = win.document.documentElement.style
  const write = () => {
    style.setProperty('--vv-top', `${String(vv.offsetTop)}px`)
    style.setProperty('--vv-height', `${String(vv.height)}px`)
  }
  // Runs for every page, vaul bottom sheets included: vaul moves the sheet itself, this only
  // scrolls the field inside whatever box it ends up in, so the two work together.
  const refocus = () => {
    write()
    const field = win.document.activeElement
    if (field && TYPED.has(field.tagName)) field.scrollIntoView({ block: 'nearest' })
  }
  write()
  vv.addEventListener('resize', refocus)
  vv.addEventListener('scroll', write)
  return () => {
    vv.removeEventListener('resize', refocus)
    vv.removeEventListener('scroll', write)
  }
}
