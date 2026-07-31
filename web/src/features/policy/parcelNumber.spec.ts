import { describe, expect, it } from 'vitest'
import { formatParcelNumber } from './parcelNumber'

describe('formatParcelNumber', () => {
  it('preserves a base parcel stable source id', () => {
    expect(formatParcelNumber('330604102014', 'base', '7')).toBe('DK-330604102014-B-7')
  })

  it('preserves a manual parcel storage id', () => {
    expect(formatParcelNumber('330604102014', 'manual', 'manual-a1b2')).toBe('DK-330604102014-M-manual-a1b2')
  })

  it('keeps village and source namespaces unique', () => {
    const numbers = new Set([
      formatParcelNumber('330604102014', 'base', '1'),
      formatParcelNumber('330604102014', 'manual', '1'),
      formatParcelNumber('330604102015', 'base', '1'),
    ])
    expect(numbers.size).toBe(3)
  })

  it('does not collapse distinct ids through padding or case conversion', () => {
    expect(formatParcelNumber('330604102014', 'base', '7')).not.toBe(formatParcelNumber('330604102014', 'base', '0007'))
    expect(formatParcelNumber('330604102014', 'manual', 'manual-a1b2')).not.toBe(formatParcelNumber('330604102014', 'manual', 'manual-A1B2'))
  })
})
