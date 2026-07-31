import { describe, expect, it } from 'vitest'
import { insuredCoverages, policyCoverages } from './policySelectors'
import type { PolicyFixture } from './policyTypes'

const fixture = {
  parcelCoverages: [
    { id: 'coverage-a', policyId: 'policy-roster', parcelId: 'parcel-1', insuredPartyId: 'party-a', insuredAreaMu: '1.0000', enrollmentItemId: 'item-a' },
    { id: 'coverage-b', policyId: 'policy-roster', parcelId: 'parcel-2', insuredPartyId: 'party-a', insuredAreaMu: '2.0000', enrollmentItemId: 'item-a' },
    { id: 'coverage-c', policyId: 'policy-roster', parcelId: 'parcel-3', insuredPartyId: 'party-b', insuredAreaMu: '3.0000', enrollmentItemId: 'item-b' },
    { id: 'coverage-d', policyId: 'policy-single', parcelId: 'parcel-4', insuredPartyId: 'party-c', insuredAreaMu: '4.0000', enrollmentItemId: null },
  ],
} as PolicyFixture

describe('policy coverage selectors', () => {
  it('returns every parcel linked to the selected roster policy', () => {
    expect(policyCoverages(fixture, 'policy-roster').map((item) => item.parcelId)).toEqual([
      'parcel-1',
      'parcel-2',
      'parcel-3',
    ])
  })

  it('can narrow the roster policy to one insured party', () => {
    expect(insuredCoverages(fixture, 'party-a', 'policy-roster').map((item) => item.parcelId)).toEqual([
      'parcel-1',
      'parcel-2',
    ])
  })
})
