import type { CultivationRecord } from './cultivationState'
import { validateCultivationRecords } from './cultivationState'
import { BUSINESS_DATE, type PolicyFixture, type ValidationResult } from './policyTypes'
import { validatePolicyFixture } from './policyValidation'
import policyFixture from '../../data/policy-v1.json'
import cultivationFixture from '../../data/cultivation-v1.json'

export interface PolicyRepositoryResult<T> {
  data: T | null
  error: string | null
}

let policyCache: PolicyFixture | null = null
let cultivationCache: CultivationRecord[] | null = null

function schemaError(label: string): string {
  return `${label}加载失败：版本不兼容或数据格式错误，请重试。`
}

export function loadPolicyFixture(): PolicyRepositoryResult<PolicyFixture> {
  if (policyCache) return { data: policyCache, error: null }
  const value = policyFixture as unknown as PolicyFixture
  const result = validatePolicyFixture(value)
  if (!result.valid) return { data: null, error: schemaError('保单数据') }
  policyCache = value
  return { data: value, error: null }
}

export function loadCultivationFixture(): PolicyRepositoryResult<CultivationRecord[]> {
  if (cultivationCache) return { data: cultivationCache, error: null }
  const value = cultivationFixture as unknown as { schemaVersion: string; businessDate: string; records: CultivationRecord[] }
  if (value.schemaVersion !== 'cultivation-v1' || value.businessDate !== BUSINESS_DATE || !Array.isArray(value.records)) return { data: null, error: schemaError('种植档案') }
  const result = validateCultivationRecords(value.records)
  if (!result.valid) return { data: null, error: schemaError('种植档案') }
  cultivationCache = value.records
  return { data: value.records, error: null }
}

export function validateLoadedPolicyData(): ValidationResult {
  const policy = loadPolicyFixture()
  if (!policy.data) return { valid: false, errors: [policy.error ?? '保单数据加载失败'], warnings: [] }
  return validatePolicyFixture(policy.data)
}

export function resetPolicyRepositoryForTests(): void {
  policyCache = null
  cultivationCache = null
}
