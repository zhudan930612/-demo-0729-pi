import type { CultivationRecord } from './cultivationState'
import { validateCultivationRecords } from './cultivationState'
import { BUSINESS_DATE, type PolicyFixture, type ValidationResult } from './policyTypes'
import { validatePolicyFixture } from './policyValidation'

export interface PolicyRepositoryResult<T> { data: T | null; error: string | null }

const DEFAULT_VILLAGE = '330604102014'

/** 业务 fixture URL 按村代码派生；龙江村保持历史 v1 文件名（现役数据不动）。 */
export function policyUrl(villageCode: string): string {
  return villageCode === DEFAULT_VILLAGE ? '/business/policy-v1.json' : `/business/policy-${villageCode}.json`
}

export function cultivationUrl(villageCode: string): string {
  return villageCode === DEFAULT_VILLAGE ? '/business/cultivation-v1.json' : `/business/cultivation-${villageCode}.json`
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

export async function loadPolicyFixture(villageCode: string = DEFAULT_VILLAGE): Promise<PolicyRepositoryResult<PolicyFixture>> {
  try {
    const value = await fetchJson(policyUrl(villageCode)) as PolicyFixture
    const result = validatePolicyFixture(value)
    if (!result.valid) return { data: null, error: '保单数据版本不兼容或格式错误。' }
    if (value.villageCode !== villageCode) return { data: null, error: '保单数据与当前村不匹配。' }
    return { data: value, error: null }
  } catch {
    return { data: null, error: '保单数据加载失败，请重试。' }
  }
}

export async function loadCultivationFixture(villageCode: string = DEFAULT_VILLAGE): Promise<PolicyRepositoryResult<CultivationRecord[]>> {
  try {
    const value = await fetchJson(cultivationUrl(villageCode)) as { schemaVersion: string; businessDate: string; records: CultivationRecord[] }
    if (value.schemaVersion !== 'cultivation-v1' || value.businessDate !== BUSINESS_DATE || !Array.isArray(value.records)) return { data: null, error: '种植档案版本不兼容或格式错误。' }
    const result = validateCultivationRecords(value.records)
    if (!result.valid) return { data: null, error: '种植档案版本不兼容或格式错误。' }
    return { data: value.records, error: null }
  } catch {
    return { data: null, error: '种植档案加载失败，请重试。' }
  }
}

export async function validateLoadedPolicyData(villageCode: string = DEFAULT_VILLAGE): Promise<ValidationResult> {
  const policy = await loadPolicyFixture(villageCode)
  if (!policy.data) return { valid: false, errors: [policy.error ?? '保单数据加载失败'], warnings: [] }
  return validatePolicyFixture(policy.data)
}
