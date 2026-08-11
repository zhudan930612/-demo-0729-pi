import { INSURED_VILLAGE_CODES } from './villageRiskData'

/**
 * 参保村敞口统计（需求 §6/§4.3/§4.5）—— 13 村保单 fixture 汇总
 * 口径（2026-08-10 定稿 + 拷打修正，真实数据验证）：
 * - **仅保障中保单的覆盖，排除已到期历史**（实测 parcelCoverages 含历史覆盖，剔除后 13 村合计面积/保额较全量低 ~9%）
 * - 参保面积（亩）= Σ 保障中 parcelCoverages.insuredAreaMu
 * - 保额（元）= Σ (保障中面积 × 所属保单 unitSumInsuredCentsPerMu) / 100（单价当前固定 1,250 元/亩，保留展示）
 * - 参保户数 = 保障中被保险人去重（覆盖 ∪ 清单），排除村集体
 * - 保单结构：保障中保单数、单一型大户保单数、清单户数（enrollmentItems 去重）
 */

export interface VillagePolicySummary {
  code: string
  insuredAreaMu: number
  sumInsuredYuan: number
  householdCount: number
  policyCount: number
  bigHolderPolicyCount: number
  rosterHouseholdCount: number
}

/** 村码 → 保单 fixture URL（龙江村沿用 policy-v1.json，其余带村码）。 */
export function policyFixtureUrl(villageCode: string): string {
  return villageCode === '330604102014' ? '/business/policy-v1.json' : `/business/policy-${villageCode}.json`
}

interface RawCoverage {
  insuredAreaMu?: unknown
  insuredPartyId?: unknown
  policyId?: unknown
}
interface RawItem {
  insuredPartyId?: unknown
}
interface RawParty {
  id?: unknown
  partyType?: unknown
}
interface RawPolicy {
  id?: unknown
  unitSumInsuredCentsPerMu?: unknown
  status?: unknown
  insuredMode?: unknown
}
export interface RawFixture {
  policies?: RawPolicy[]
  parcelCoverages?: RawCoverage[]
  enrollmentItems?: RawItem[]
  parties?: RawParty[]
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** 单村 fixture → 汇总（缺失/异常字段容错为 0，不阻断；仅统计保障中保单）。 */
export function summarizePolicyFixture(fixture: RawFixture): Omit<VillagePolicySummary, 'code'> {
  const activePolicies = (fixture.policies ?? []).filter((policy) => String(policy.status ?? '') === '保障中')
  const unitByPolicy = new Map<string, number>()
  for (const policy of activePolicies) {
    const id = String(policy.id ?? '')
    if (id) unitByPolicy.set(id, finiteNumber(policy.unitSumInsuredCentsPerMu))
  }
  const activePolicyIds = new Set(unitByPolicy.keys())

  let insuredAreaMu = 0
  let sumCents = 0
  const partyIds = new Set<string>()
  for (const coverage of fixture.parcelCoverages ?? []) {
    const policyId = String(coverage.policyId ?? '')
    if (!activePolicyIds.has(policyId)) continue // 排除历史（已到期）保单覆盖
    const mu = finiteNumber(coverage.insuredAreaMu)
    insuredAreaMu += mu
    sumCents += mu * (unitByPolicy.get(policyId) ?? 0)
    const partyId = String(coverage.insuredPartyId ?? '')
    if (partyId) partyIds.add(partyId)
  }
  const rosterHouseholdIds = new Set<string>()
  for (const item of fixture.enrollmentItems ?? []) {
    const partyId = String(item.insuredPartyId ?? '')
    if (partyId) rosterHouseholdIds.add(partyId)
  }
  for (const id of rosterHouseholdIds) partyIds.add(id)
  // 排除村集体（如"清潭村股份经济合作社"）
  for (const party of fixture.parties ?? []) {
    if (party.partyType === '村集体') partyIds.delete(String(party.id ?? ''))
  }
  return {
    insuredAreaMu: Math.round(insuredAreaMu * 100) / 100,
    sumInsuredYuan: Math.round(sumCents) / 100,
    householdCount: partyIds.size,
    policyCount: activePolicies.length,
    bigHolderPolicyCount: activePolicies.filter((policy) => String(policy.insuredMode ?? '') === 'single_insured').length,
    rosterHouseholdCount: rosterHouseholdIds.size,
  }
}

export interface PolicySummaryLoadOptions {
  fetchImpl?: typeof fetch
}

/** 并行加载 13 村保单汇总；单文件失败降级为该村 0 汇总（敞口显示 0/"—"，不阻断其余）。 */
export async function loadPolicySummaries(options: PolicySummaryLoadOptions = {}): Promise<Map<string, VillagePolicySummary>> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const results = new Map<string, VillagePolicySummary>()
  await Promise.all(INSURED_VILLAGE_CODES.map(async (code) => {
    try {
      const response = await fetchImpl(policyFixtureUrl(code))
      if (!response.ok) throw new Error(`policy fixture ${code} -> ${response.status}`)
      const fixture = (await response.json()) as RawFixture
      results.set(code, { code, ...summarizePolicyFixture(fixture) })
    } catch {
      results.set(code, { code, insuredAreaMu: 0, sumInsuredYuan: 0, householdCount: 0, policyCount: 0, bigHolderPolicyCount: 0, rosterHouseholdCount: 0 })
    }
  }))
  return results
}
