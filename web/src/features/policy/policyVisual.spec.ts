import { describe, expect, it } from 'vitest'
import { linkedParcelStyle, policyBusinessType } from './policyVisual'

describe('policy visual semantics', () => {
  it('maps policy modes to the approved business labels', () => {
    expect(policyBusinessType('single_insured')).toBe('大户')
    expect(policyBusinessType('insured_roster')).toBe('团单')
    expect(policyBusinessType(null)).toBe('未参保')
  })

  it('uses solid green for large-holder linked parcels', () => {
    expect(linkedParcelStyle('single_insured')).toMatchObject({ color: '#16a34a' })
    expect(linkedParcelStyle('single_insured')).not.toHaveProperty('dashArray')
  })

  it('uses a thin solid purple line for group-policy linked parcels', () => {
    expect(linkedParcelStyle('insured_roster')).toMatchObject({ color: '#8b5cf6', weight: 2 })
    expect(linkedParcelStyle('insured_roster')).not.toHaveProperty('dashArray')
  })

  it('does not assign an association style to uninsured parcels', () => {
    expect(linkedParcelStyle(null)).toBeNull()
  })
})
