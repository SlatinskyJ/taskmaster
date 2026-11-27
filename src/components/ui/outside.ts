// While a Radix dialog or a vaul sheet is open, a pointer-down or focus outside it closes it. The
// live change banner (src/components/live/) sits outside: tapping it must leave the dialog and
// what was typed in it alone (#299). The toasts get pointer events back in src/styles/app.css.

/** The event's target is inside Sonner's toaster. */
export function fromToaster(target: EventTarget | null): boolean {
  const closest = (target as { closest?: unknown } | null)?.closest
  if (typeof closest !== 'function') return false
  return (target as Element).closest('[data-sonner-toaster]') !== null
}

/** An outside handler that ignores the toaster, then runs the caller's own. */
export function keepOpenForToaster<E extends Event>(own?: (e: E) => void): (e: E) => void {
  return (e) => {
    if (fromToaster(e.target)) e.preventDefault()
    own?.(e)
  }
}
