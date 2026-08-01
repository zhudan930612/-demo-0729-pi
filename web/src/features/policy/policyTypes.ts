export const POLICY_SCHEMA_VERSION = 'policy-v1'
export const BUSINESS_DATE = '2025-07-15'
export const MONEY_SCALE = 100
export const AREA_SCALE = 10_000
export const INSURANCE_PRODUCT = '水稻完全成本保险'
export const INSURED_OBJECT = '水稻'
export const UNIT_SUM_INSURED_CENTS_PER_MU = 125_000
export const PREMIUM_CENTS_PER_MU = 4_000
export const SUBSIDY_RATE = '0.80'
export const PREMIUM_RATE = '0.032'

export type MoneyCents = number
export type AreaMu = string
export type PolicyStatus = '待生效' | '保障中' | '已到期'
export type PolicyInsuredMode = 'single_insured' | 'insured_roster'
export type PartyType = '自然人' | '家庭农场' | '合作社' | '村集体'

export interface Party {
  id: string
  name: string
  partyType: PartyType
  identityOrOrgCode?: string
  contactPhone?: string
  bankAccount?: string
  bankName?: string
  remark?: string
  signature?: string
}

export interface PolicySummary {
  insuredPartyCount: number
  parcelCount: number
  insuredAreaMu: AreaMu
  sum_insured_cents: MoneyCents
  premium_cents: MoneyCents
  subsidy_cents: MoneyCents
  self_paid_cents: MoneyCents
}

export interface Policy {
  id: string
  policyNo: string
  insuredMode: PolicyInsuredMode
  insuredPartyId: string | null
  enrollmentListId: string | null
  villageCode: string
  product: string
  insuredObject: string
  unitSumInsuredCentsPerMu: MoneyCents
  premiumRate: string
  subsidyRate: string
  signDate: string
  periodStart: string
  periodEnd: string
  status: PolicyStatus
  summary: PolicySummary
}

export interface EnrollmentList {
  id: string
  policyId: string
  applicantPartyId: string
  itemIds: string[]
}

export interface EnrollmentItem {
  id: string
  enrollmentListId: string
  itemNo: string
  insuredPartyId: string
  parcelCoverageIds: string[]
  insuredAreaMu: AreaMu
  sum_insured_cents: MoneyCents
  premium_cents: MoneyCents
  subsidy_cents: MoneyCents
  self_paid_cents: MoneyCents
}

export interface ParcelCoverage {
  id: string
  policyId: string
  parcelId: string
  insuredPartyId: string
  insuredAreaMu: AreaMu
  enrollmentItemId: string | null
}

export interface ClaimSummary {
  id: string
  policyId: string
  insuredPartyId: string
  enrollmentItemId: string | null
  reportCount: number
  estimatedLossCents: MoneyCents
  paidCents: MoneyCents
  latestReportDate: string
  latestStatus: string
}

export interface PolicyFixture {
  schemaVersion: typeof POLICY_SCHEMA_VERSION
  businessDate: string
  villageCode: string
  parties: Party[]
  policies: Policy[]
  enrollmentLists: EnrollmentList[]
  enrollmentItems: EnrollmentItem[]
  parcelCoverages: ParcelCoverage[]
  claims: ClaimSummary[]
  report?: Record<string, unknown>
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/** Parse a non-negative decimal into an exact scaled integer (no binary float). */
function decimalPlaces(scale: number): number {
  if (!Number.isSafeInteger(scale) || scale <= 0 || !/^10+$/.test(String(scale))) throw new Error('缩放倍数必须是 10 的幂')
  return String(scale).length - 1
}

export function toScaledInteger(value: string | number, scale = AREA_SCALE): number | null {
  const places = decimalPlaces(scale)
  const text = String(value).trim()
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > places) return null
  const digits = fraction.padEnd(places, '0')
  const result = Number(whole) * scale + Number(digits || 0)
  return Number.isSafeInteger(result) ? result : null
}

export function formatScaledInteger(value: number, scale = AREA_SCALE, fractionDigits = decimalPlaces(scale)): string {
  const places = decimalPlaces(scale)
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('非法缩放整数')
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > places) throw new Error('非法小数位数')
  const whole = Math.floor(value / scale)
  const fraction = String(value % scale).padStart(places, '0').slice(0, fractionDigits)
  return fractionDigits ? `${whole}.${fraction}` : String(whole)
}

export function roundScaled(value: number, fromScale: number, toScale: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || fromScale <= 0 || toScale <= 0) throw new Error('非法缩放整数')
  if (fromScale <= toScale) return value * (toScale / fromScale)
  const factor = fromScale / toScale
  return Math.floor(value / factor + 0.5)
}
