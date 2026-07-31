import {
  AREA_SCALE,
  BUSINESS_DATE,
  formatScaledInteger,
  type EnrollmentItem,
  type ParcelCoverage,
  type Policy,
  type PolicyFixture,
  type PolicyStatus,
  roundScaled,
  toScaledInteger,
  UNIT_SUM_INSURED_CENTS_PER_MU,
} from './policyTypes'
import type { ValidationResult } from './policyTypes'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isBusinessDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

export function calculatePolicyStatus(periodStart: string, periodEnd: string, businessDate = BUSINESS_DATE): PolicyStatus {
  if (businessDate < periodStart) return '待生效'
  if (businessDate > periodEnd) return '已到期'
  return '保障中'
}

export function classifyInsuredArea(areaMu: string | number): 'insured_roster' | 'single_insured' {
  const area = toScaledInteger(areaMu, AREA_SCALE)
  if (area === null) throw new Error('承保面积必须是非负十进制数')
  const roundedCentsOfMu = roundScaled(area, AREA_SCALE, 100)
  return roundedCentsOfMu <= 5_000 ? 'insured_roster' : 'single_insured'
}

export function formatAreaMu(areaMu: string | number, fractionDigits = 2): string {
  const scaled = toScaledInteger(areaMu, AREA_SCALE)
  if (scaled === null) throw new Error('面积必须是最多四位小数的非负十进制数')
  return formatScaledInteger(roundScaled(scaled, AREA_SCALE, 100), 100, fractionDigits)
}

export function validateCoverageArea(insuredAreaMu: string | number, geometryAreaMu: string | number): string[] {
  const insured = toScaledInteger(insuredAreaMu, AREA_SCALE)
  const geometry = toScaledInteger(geometryAreaMu, AREA_SCALE)
  if (insured === null || geometry === null) return ['承保面积和地块几何面积必须是最多四位小数的非负数']
  if (insured <= 0) return ['承保面积必须大于 0']
  if (insured > geometry) return ['承保面积不得超过地块几何面积']
  return []
}

function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA <= endB && startB <= endA
}

export function findOverlappingCoverages(coverages: ParcelCoverage[], policies: Policy[]): Array<{ parcelId: string; policyIds: string[] }> {
  const policyById = new Map(policies.map((policy) => [policy.id, policy]))
  const grouped = new Map<string, ParcelCoverage[]>()
  for (const coverage of coverages) {
    const list = grouped.get(coverage.parcelId) ?? []
    list.push(coverage)
    grouped.set(coverage.parcelId, list)
  }
  const result: Array<{ parcelId: string; policyIds: string[] }> = []
  for (const [parcelId, list] of grouped) {
    const policyIds = new Set<string>()
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const first = policyById.get(list[i].policyId)
        const second = policyById.get(list[j].policyId)
        if (first && second && overlaps(first.periodStart, first.periodEnd, second.periodStart, second.periodEnd)) {
          policyIds.add(first.id)
          policyIds.add(second.id)
        }
      }
    }
    if (policyIds.size > 1) result.push({ parcelId, policyIds: [...policyIds].sort() })
  }
  return result
}

export function validatePolicyFixture(fixture: PolicyFixture, geometryAreas: Record<string, string | number> = {}): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (fixture.schemaVersion !== 'policy-v1') errors.push('不支持的保单 schema 版本')
  if (fixture.businessDate !== BUSINESS_DATE) errors.push(`业务日期必须为 ${BUSINESS_DATE}`)
  if (!isBusinessDate(fixture.businessDate)) errors.push('业务日期格式非法')
  const policyIds = new Set<string>()
  const partyIds = new Set(fixture.parties.map((party) => party.id))
  for (const policy of fixture.policies) {
    if (policyIds.has(policy.id)) errors.push(`保单 ID 重复：${policy.id}`)
    policyIds.add(policy.id)
    if (!/^\d{22}$/.test(policy.policyNo)) errors.push(`保单号必须为 22 位数字：${policy.id}`)
    if (!isBusinessDate(policy.periodStart) || !isBusinessDate(policy.periodEnd) || policy.periodStart > policy.periodEnd) errors.push(`保险期间非法：${policy.id}`)
    if (policy.status !== calculatePolicyStatus(policy.periodStart, policy.periodEnd, BUSINESS_DATE)) errors.push(`保单状态与期间不一致：${policy.id}`)
    if (policy.insuredMode === 'single_insured' && (!policy.insuredPartyId || policy.enrollmentListId !== null)) errors.push(`单一型保单引用非法：${policy.id}`)
    if (policy.insuredMode === 'insured_roster' && (!policy.enrollmentListId || policy.insuredPartyId !== null)) errors.push(`清单型保单引用非法：${policy.id}`)
    if (policy.insuredPartyId && !partyIds.has(policy.insuredPartyId)) errors.push(`保单主体不存在：${policy.id}`)
  }
  const itemById = new Map(fixture.enrollmentItems.map((item) => [item.id, item]))
  for (const item of fixture.enrollmentItems) {
    if (!partyIds.has(item.insuredPartyId)) errors.push(`清单项主体不存在：${item.id}`)
    const area = toScaledInteger(item.insuredAreaMu, AREA_SCALE)
    if (area === null) errors.push(`清单项面积非法：${item.id}`)
    const expected = area === null ? null : Math.round(area * UNIT_SUM_INSURED_CENTS_PER_MU / AREA_SCALE)
    if (expected !== null && item.sum_insured_cents !== expected) errors.push(`清单项保额汇总不一致：${item.id}`)
  }
  for (const coverage of fixture.parcelCoverages) {
    const policy = fixture.policies.find((candidate) => candidate.id === coverage.policyId)
    if (!policy) errors.push(`承保明细保单不存在：${coverage.id}`)
    if (coverage.enrollmentItemId !== null && !itemById.has(coverage.enrollmentItemId)) errors.push(`承保明细清单项不存在：${coverage.id}`)
    if (geometryAreas[coverage.parcelId] !== undefined) errors.push(...validateCoverageArea(coverage.insuredAreaMu, geometryAreas[coverage.parcelId]).map((error) => `${coverage.id}：${error}`))
  }
  const overlapsFound = findOverlappingCoverages(fixture.parcelCoverages, fixture.policies.filter((policy) => policy.status !== '已到期'))
  if (overlapsFound.length) errors.push(`存在同期重复承保地块：${overlapsFound.map((item) => item.parcelId).join(', ')}`)
  return { valid: errors.length === 0, errors, warnings }
}

function roundRatio(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error('金额计算溢出')
  const quotient = Math.floor(numerator / denominator)
  return quotient + (numerator % denominator >= denominator / 2 ? 1 : 0)
}

export function calculateCoverageAmounts(areaMu: string | number): { sumInsuredCents: number; premiumCents: number; subsidyCents: number; selfPaidCents: number } | null {
  const area = toScaledInteger(areaMu, AREA_SCALE)
  if (area === null) return null
  const sumInsuredCents = roundRatio(area * UNIT_SUM_INSURED_CENTS_PER_MU, AREA_SCALE)
  const premiumCents = roundRatio(sumInsuredCents * 32, 1000)
  const subsidyCents = roundRatio(premiumCents * 80, 100)
  return { sumInsuredCents, premiumCents, subsidyCents, selfPaidCents: premiumCents - subsidyCents }
}

export function validateSummaryAmounts(item: EnrollmentItem, areaMu: string | number): string[] {
  const amounts = calculateCoverageAmounts(areaMu)
  if (!amounts) return ['面积格式非法']
  const errors: string[] = []
  if (item.sum_insured_cents !== amounts.sumInsuredCents) errors.push('保额汇总不一致')
  if (item.premium_cents !== amounts.premiumCents) errors.push('保费汇总不一致')
  if (item.subsidy_cents !== amounts.subsidyCents) errors.push('补贴汇总不一致')
  if (item.self_paid_cents !== amounts.selfPaidCents) errors.push('自缴汇总不一致')
  return errors
}
