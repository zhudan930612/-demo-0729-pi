import type { CultivationRecord } from './cultivationState'
import { validateCultivationRecords } from './cultivationState'
import { BUSINESS_DATE, type PolicyFixture, type ValidationResult } from './policyTypes'
import { validatePolicyFixture } from './policyValidation'

export interface PolicyRepositoryResult<T> { data: T | null; error: string | null }
const POLICY_URL = '/business/policy-v1.json'
const CULTIVATION_URL = '/business/cultivation-v1.json'

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

export async function loadPolicyFixture(): Promise<PolicyRepositoryResult<PolicyFixture>> {
  try {
    const value = await fetchJson(POLICY_URL) as PolicyFixture
    const result = validatePolicyFixture(value)
    if (!result.valid) return { data: null, error: '保单数据版本不兼容或格式错误。' }
    return { data: value, error: null }
  } catch {
    return { data: null, error: '保单数据加载失败，请重试。' }
  }
}

export async function loadCultivationFixture(): Promise<PolicyRepositoryResult<CultivationRecord[]>> {
  try {
    const value = await fetchJson(CULTIVATION_URL) as { schemaVersion: string; businessDate: string; records: CultivationRecord[] }
    if (value.schemaVersion !== 'cultivation-v1' || value.businessDate !== BUSINESS_DATE || !Array.isArray(value.records)) return { data: null, error: '种植档案版本不兼容或格式错误。' }
    const result = validateCultivationRecords(value.records)
    if (!result.valid) return { data: null, error: '种植档案版本不兼容或格式错误。' }
    return { data: value.records, error: null }
  } catch {
    return { data: null, error: '种植档案加载失败，请重试。' }
  }
}

export async function validateLoadedPolicyData(): Promise<ValidationResult> {
  const policy = await loadPolicyFixture()
  if (!policy.data) return { valid: false, errors: [policy.error ?? '保单数据加载失败'], warnings: [] }
  return validatePolicyFixture(policy.data)
}
