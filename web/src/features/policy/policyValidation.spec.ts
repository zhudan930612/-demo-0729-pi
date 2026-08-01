import { describe, expect, it } from 'vitest'
import { calculatePolicyStatus, classifyInsuredArea, findOverlappingCoverages, formatAreaMu, validateCoverageArea, validatePolicyFixture } from './policyValidation'
import type { Policy, ParcelCoverage, PolicyFixture } from './policyTypes'

const policy = (id: string, start: string, end: string, status: Policy['status']): Policy => ({
  id, policyNo: '1234567890123456789012', insuredMode: 'single_insured', insuredPartyId: 'p', enrollmentListId: null,
  villageCode: 'v', product: '政策性水稻完全成本保险', insuredObject: '水稻', unitSumInsuredCentsPerMu: 125000,
  premiumRate: '0.032', subsidyRate: '0.80', signDate: '2025-01-01', periodStart: start, periodEnd: end, status,
  summary: { insuredPartyCount: 1, parcelCount: 1, insuredAreaMu: '1.0000', sum_insured_cents: 125000, premium_cents: 4000, subsidy_cents: 3200, self_paid_cents: 800 },
})

describe('policy validation', () => {
  it('uses the fixed date for status and supports all status boundaries', () => {
    expect(calculatePolicyStatus('2025-07-16', '2025-11-30')).toBe('待生效')
    expect(calculatePolicyStatus('2025-05-01', '2025-11-30')).toBe('保障中')
    expect(calculatePolicyStatus('2024-05-01', '2024-11-30')).toBe('已到期')
  })
  it('classifies after four-decimal sum and rounds 50.00/50.01 correctly', () => {
    expect(classifyInsuredArea('50.0049')).toBe('insured_roster')
    expect(classifyInsuredArea('50.0050')).toBe('single_insured')
    expect(formatAreaMu('50.0050')).toBe('50.01')
  })
  it('enforces positive coverage not exceeding geometry', () => {
    expect(validateCoverageArea('1.0000', '1.0000')).toEqual([])
    expect(validateCoverageArea('0', '1')).not.toEqual([])
    expect(validateCoverageArea('1.01', '1')).not.toEqual([])
  })
  it('finds overlapping current policies but permits history', () => {
    const current = [policy('a', '2025-05-01', '2025-11-30', '保障中'), policy('b', '2025-06-01', '2025-12-01', '保障中')]
    const coverages: ParcelCoverage[] = current.map((p) => ({ id: p.id, policyId: p.id, parcelId: '1', insuredPartyId: 'p', insuredAreaMu: '1.0000', enrollmentItemId: null }))
    expect(findOverlappingCoverages(coverages, current)).toEqual([{ parcelId: '1', policyIds: ['a', 'b'] }])
    expect(findOverlappingCoverages(coverages, [current[0], policy('b', '2024-01-01', '2024-12-01', '已到期')])).toEqual([])
  })
  it('validates fixed date, references, status and policy number', () => {
    const fixture: PolicyFixture = { schemaVersion: 'policy-v1', businessDate: '2025-07-15', villageCode: 'v', parties: [{ id: 'p', name: 'x', partyType: '自然人' }], policies: [policy('a', '2025-05-01', '2025-11-30', '保障中')], enrollmentLists: [], enrollmentItems: [], parcelCoverages: [], claims: [] }
    expect(validatePolicyFixture(fixture).valid).toBe(true)
    fixture.policies[0].status = '已到期'
    expect(validatePolicyFixture(fixture).errors).toContain('保单状态与期间不一致：a')
  })
})
