import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Input } from './input'

// iOS draws time and date fields with a native look and a minimum width of their own, wider
// than a half-width grid column (#216). Without that look they keep the width they are given.

const NATIVE_OFF = 'appearance-none'
const LEFT_VALUE = '[&amp;::-webkit-date-and-time-value]:text-left'

describe('Input (#216)', () => {
  it.each(['time', 'date'])('a %s field drops the native look and keeps its size', (type) => {
    const html = renderToStaticMarkup(<Input type={type} />)
    expect(html).toContain(NATIVE_OFF)
    expect(html).toContain(LEFT_VALUE)
    expect(html).toContain('min-w-0')
    expect(html).toContain('min-h-tap')
  })

  it.each([undefined, 'text', 'password'])('a %s field keeps its look', (type) => {
    const html = renderToStaticMarkup(<Input type={type} />)
    expect(html).not.toContain(NATIVE_OFF)
    expect(html).not.toContain('date-and-time-value')
  })
})
