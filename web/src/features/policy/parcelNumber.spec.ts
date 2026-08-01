import { describe, expect, it } from 'vitest'
import { formatParcelNumber } from './parcelNumber'

describe('formatParcelNumber', () => {
  it('preserves a base parcel stable source id', () => {
    expect(formatParcelNumber('330604102014', 'base', '7')).toBe('DK-330604102014-B-7')
  })

  it('keeps village and source namespaces unique', () => {
    const numbers = new Set([
      formatParcelNumber('330604102014', 'base', '1'),
      formatParcelNumber('330604102014', 'manual', '1'),
      formatParcelNumber('330604102015', 'base', '1'),
    ])
    expect(numbers.size).toBe(3)
  })

  it('keeps base parcel ids opaque and stable', () => {
    expect(formatParcelNumber('330604102014', 'base', 'manual-a1b2')).toBe('DK-330604102014-B-manual-a1b2')
  })
})
