// The part of the screen a person can see: on a phone the keyboard covers the rest (#215).
// Mirrors window.visualViewport into `--vv-top` and `--vv-height` on <html>. The reader is
// `dialogPlacement` in src/components/ui/dialog.tsx, which centres dialogs in that box.

interface ViewportWindow {
  visualViewport: Pick<
    VisualViewport,
    'offsetTop' | 'height' | 'addEventListener' | 'removeEventListener'
  > | null
  document: { documentElement: { style: Pick<CSSStyleDeclaration, 'setProperty'> } }
}

/** Starts mirroring; returns the cleanup. Without a visual viewport it does nothing. */
export function trackVisualViewport(win: ViewportWindow): () => void {
  const vv = win.visualViewport
  if (!vv) return () => undefined
  const style = win.document.documentElement.style
  const write = () => {
    style.setProperty('--vv-top', `${String(vv.offsetTop)}px`)
    style.setProperty('--vv-height', `${String(vv.height)}px`)
  }
  write()
  vv.addEventListener('resize', write)
  vv.addEventListener('scroll', write)
  return () => {
    vv.removeEventListener('resize', write)
    vv.removeEventListener('scroll', write)
  }
}
