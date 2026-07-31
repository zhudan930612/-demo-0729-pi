import { describe, expect, it } from 'vitest'
import { createParcelDetailClickGuard } from './parcelDetailClickGuard'

describe('parcel detail click guard', () => {
  it('consumes a map click carrying the same native event exactly once', () => {
    const guard = createParcelDetailClickGuard()
    const event = new Event('click')
    guard.markParcelClick(event)
    expect(guard.consumeMapClick(event)).toBe(true)
    expect(guard.consumeMapClick(event)).toBe(false)
  })

  it('does not consume a later independent blank-map click', () => {
    const guard = createParcelDetailClickGuard()
    guard.markParcelClick(new Event('click'))
    expect(guard.consumeMapClick(new Event('click'))).toBe(false)
  })

  it('still matches a delayed map event without a timing race', async () => {
    const guard = createParcelDetailClickGuard()
    const event = new Event('click')
    guard.markParcelClick(event)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(guard.consumeMapClick(event)).toBe(true)
  })
})
