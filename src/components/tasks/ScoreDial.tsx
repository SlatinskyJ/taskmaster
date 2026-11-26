import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '~/lib/utils'

/** Pixels of swipe per point; also the gap between the numbers on the dial. */
export const DIAL_STEP_PX = 36
/** The gap once a three-digit number is in the middle or next to it (#190). */
const WIDE_STEP_PX = 52

/**
 * The gap for the current value: wider from 99 up, so a three-digit neighbour doesn't run into
 * the big middle number ("99100101", #190). Scores stop at 999, so two sizes are enough.
 */
export function dialStepPx(value: number): number {
  return String(value + 1).length > 2 ? WIDE_STEP_PX : DIAL_STEP_PX
}
/** How many numbers show on each side of the current one. */
const SIDE = 5

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/**
 * The value after swiping `deltaPx` from where the drag started at `startValue`. Swiping left
 * pulls higher numbers to the middle (like a ruler), so a negative delta adds points.
 * `stepPx` is the gap at the start of the drag (`dialStepPx`). `offset` is the leftover
 * sub-step shift, so the numbers follow the finger smoothly; it is 0 at either end of the range.
 */
export function dialStep(
  startValue: number,
  deltaPx: number,
  min: number,
  max: number,
  stepPx: number = DIAL_STEP_PX,
): { value: number; offset: number } {
  const steps = Math.round(-deltaPx / stepPx)
  const value = clamp(startValue + steps, min, max)
  const atEnd = value !== startValue + steps
  return { value, offset: atEnd ? 0 : deltaPx + steps * stepPx }
}

/** Keyboard on the dial (WAI-ARIA slider): arrows ±1, Page Up/Down ±5, Home/End to the ends. */
export function dialKey(key: string, value: number, min: number, max: number): number | null {
  const by: Record<string, number> = {
    ArrowRight: 1,
    ArrowUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
    PageUp: 5,
    PageDown: -5,
  }
  if (key === 'Home') return min
  if (key === 'End') return max
  const d = by[key]
  return d === undefined ? null : clamp(value + d, min, max)
}

/**
 * A horizontal points dial (Jakub 2026-11-18): swipe left for more, right for fewer. The
 * current value sits big in the middle with its neighbours fading out to the sides. Works as
 * an ARIA slider with the keyboard. Pair it with − / + buttons for single steps.
 */
export function ScoreDial({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** Accessible name, e.g. "Body". */
  label: string
}) {
  const drag = useRef<{ x: number; value: number; step: number } | null>(null)
  const [offset, setOffset] = useState(0)
  /** The gap of the running drag (null when not dragging). */
  const [dragStep, setDragStep] = useState<number | null>(null)

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    // One gap for the whole drag, also when it crosses 99, so the numbers stay under the finger.
    const step = dialStepPx(value)
    drag.current = { x: e.clientX, value, step }
    setDragStep(step)
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    const { x, value: start, step } = drag.current
    const next = dialStep(start, e.clientX - x, min, max, step)
    setOffset(next.offset)
    if (next.value !== value) onChange(next.value)
  }
  function onPointerEnd() {
    drag.current = null
    setDragStep(null)
    setOffset(0)
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = dialKey(e.key, value, min, max)
    if (next === null) return
    e.preventDefault()
    onChange(next)
  }

  const step = dragStep ?? dialStepPx(value)
  const numbers: number[] = []
  for (let n = Math.max(min, value - SIDE); n <= Math.min(max, value + SIDE); n++) numbers.push(n)

  return (
    <>
      {/* Announces changes from the − / + buttons and quick picks too, not only while focused. */}
      <output aria-live="polite" className="sr-only">
        {value}
      </output>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
        className="relative h-20 flex-1 cursor-grab touch-pan-y overflow-hidden rounded-card bg-bg select-none focus-visible:outline-2 focus-visible:outline-accent-strong active:cursor-grabbing"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 30%, black 70%, transparent)',
        }}
      >
        <span
          aria-hidden="true"
          className="absolute top-0 left-1/2 h-2 w-1 -translate-x-1/2 rounded-b-full bg-accent-strong"
        />
        {numbers.map((n) => {
          const distance = Math.abs(n - value)
          return (
            <span
              key={n}
              aria-hidden="true"
              className={cn(
                'absolute top-1/2 grid -translate-1/2 justify-items-center gap-1 num font-bold',
                dragStep === null &&
                  'transition-[left] duration-200 ease-out motion-reduce:transition-none',
                distance === 0 ? 'text-points text-ink' : 'text-lg text-muted',
              )}
              style={{
                left: `calc(50% + ${String((n - value) * step + offset)}px)`,
                opacity: distance === 0 ? 1 : Math.max(0.25, 1 - distance * 0.18),
              }}
            >
              {n}
              <span className="h-2 w-0.5 rounded-full bg-current opacity-50" />
            </span>
          )
        })}
      </div>
    </>
  )
}
