import type { ManualParcelFeature } from '../../utils/manualParcelStorage'
import { getCurrentCultivationRecord, type CultivationRecord } from './cultivationState'
import type { ClaimSummary, EnrollmentItem, ParcelCoverage, Party, Policy, PolicyFixture } from './policyTypes'

export interface ParcelPolicyContext {
  currentCoverage: ParcelCoverage | null
  currentPolicy: Policy | null
  currentItem: EnrollmentItem | null
  currentInsured: Party | null
  applicant: Party | null
  history: Array<{ coverage: ParcelCoverage; policy: Policy; insured: Party | null; item: EnrollmentItem | null }>
}

export interface ParcelSummaryInput {
  id: string
  source: 'base' | 'manual'
  areaMu: number
  areaM2: number
  createdAt?: string
  updatedAt?: string
  displayNo?: number
}

export function parcelPolicyContext(fixture: PolicyFixture, parcelId: string): ParcelPolicyContext {
  const policyById = new Map(fixture.policies.map((item) => [item.id, item]))
  const partyById = new Map(fixture.parties.map((item) => [item.id, item]))
  const itemById = new Map(fixture.enrollmentItems.map((item) => [item.id, item]))
  const all = fixture.parcelCoverages
    .filter((coverage) => coverage.parcelId === parcelId)
    .map((coverage) => ({ coverage, policy: policyById.get(coverage.policyId)!, insured: partyById.get(coverage.insuredPartyId) ?? null, item: coverage.enrollmentItemId ? itemById.get(coverage.enrollmentItemId) ?? null : null }))
    .filter((entry) => Boolean(entry.policy))
  const current = all.find((entry) => entry.policy.status === '保障中' || entry.policy.status === '待生效') ?? null
  const list = current?.policy.enrollmentListId ? fixture.enrollmentLists.find((entry) => entry.id === current.policy.enrollmentListId) : null
  const applicant = list ? partyById.get(list.applicantPartyId) ?? null : current?.policy.insuredPartyId ? partyById.get(current.policy.insuredPartyId) ?? null : null
  return {
    currentCoverage: current?.coverage ?? null,
    currentPolicy: current?.policy ?? null,
    currentItem: current?.item ?? null,
    currentInsured: current?.insured ?? null,
    applicant,
    history: all.filter((entry) => entry.policy.status === '已到期'),
  }
}

export function insuredCoverages(fixture: PolicyFixture, insuredPartyId: string, policyId: string): ParcelCoverage[] {
  return fixture.parcelCoverages.filter((coverage) => coverage.policyId === policyId && coverage.insuredPartyId === insuredPartyId)
}

export function policyCoverages(fixture: PolicyFixture, policyId: string): ParcelCoverage[] {
  return fixture.parcelCoverages.filter((coverage) => coverage.policyId === policyId)
}

export function claimForInsured(fixture: PolicyFixture, policyId: string, insuredPartyId: string): ClaimSummary | null {
  return fixture.claims.find((claim) => claim.policyId === policyId && claim.insuredPartyId === insuredPartyId) ?? null
}

export function summarizePolicyClaims(fixture: PolicyFixture, policyId: string) {
  const claims = fixture.claims.filter((claim) => claim.policyId === policyId && claim.reportCount > 0)
  return {
    insuredCount: new Set(claims.map((claim) => claim.insuredPartyId)).size,
    surveying: claims.filter((claim) => claim.latestStatus === '查勘中').length,
    adjusting: claims.filter((claim) => claim.latestStatus === '核赔中').length,
    closed: claims.filter((claim) => claim.latestStatus === '已结案').length,
    estimatedLossCents: claims.reduce((sum, claim) => sum + claim.estimatedLossCents, 0),
    paidCents: claims.reduce((sum, claim) => sum + claim.paidCents, 0),
  }
}

export function currentCultivation(records: CultivationRecord[]) {
  return getCurrentCultivationRecord(records)
}

export function fromBaseParcel(properties: Record<string, unknown>): ParcelSummaryInput | null {
  const id = properties.id
  const areaMu = Number(properties.area_mu)
  const areaM2 = Number(properties.area_m2)
  if (id == null || !Number.isFinite(areaMu) || !Number.isFinite(areaM2)) return null
  return { id: String(id), source: 'base', areaMu, areaM2 }
}

export function fromManualParcel(feature: ManualParcelFeature): ParcelSummaryInput {
  return { id: feature.properties.id, source: 'manual', areaMu: feature.properties.area_mu, areaM2: feature.properties.area_m2, createdAt: feature.properties.created_at, updatedAt: feature.properties.updated_at, displayNo: feature.properties.display_no }
}
