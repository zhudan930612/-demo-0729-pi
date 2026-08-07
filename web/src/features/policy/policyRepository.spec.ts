import { describe, expect, it } from 'vitest'
import { cultivationUrl, policyUrl } from './policyRepository'

describe('policy repository URLs', () => {
  it('keeps the longjiang legacy v1 filenames', () => {
    expect(policyUrl('330604102014')).toBe('/business/policy-v1.json')
    expect(cultivationUrl('330604102014')).toBe('/business/cultivation-v1.json')
  })
  it('derives per-village filenames for other villages', () => {
    expect(policyUrl('330604102016')).toBe('/business/policy-330604102016.json')
    expect(cultivationUrl('330604102016')).toBe('/business/cultivation-330604102016.json')
    expect(policyUrl('330683104307')).toBe('/business/policy-330683104307.json')
  })
})
