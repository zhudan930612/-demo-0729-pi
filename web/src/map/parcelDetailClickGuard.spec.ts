import { describe, expect, it } from 'vitest'
import { createParcelDetailClickGuard } from './parcelDetailClickGuard'

describe('parcel detail click guard', () => {
  it('consumes the map click emitted after a parcel click exactly once', () => {
    const guard = createParcelDetailClickGuard()
    guard.markParcelClick()
    expect(guard.consumeMapClick()).toBe(true)
    expect(guard.consumeMapClick()).toBe(false)
  })

  it('does not consume an independent blank-map click', () => {
    const guard = createParcelDetailClickGuard()
    expect(guard.consumeMapClick()).toBe(false)
  })

  it('releases the guard when Leaflet does not emit a map click', () => {
    const guard = createParcelDetailClickGuard()
    guard.markParcelClick()
    guard.releaseParcelClick()
    expect(guard.consumeMapClick()).toBe(false)
  })
})
