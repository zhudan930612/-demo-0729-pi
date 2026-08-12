import { describe, expect, it, vi } from 'vitest'
import { INSURED_VILLAGE_CODES } from './villageRiskData'
import {
  loadPolicySummaries,
  policyFixtureUrl,
  summarizePolicyFixture,
  type RawFixture,
} from './villagePolicySummary'

function makeFixture(overrides: Record<string, unknown> = {}): RawFixture {
  return {
    policies: [
      { id: 'policy-1', unitSumInsuredCentsPerMu: 4000, status: '保障中', insuredMode: 'single_insured', product: '政策性水稻完全成本保险', insuredObject: '水稻', premiumRate: 0.032, periodStart: '2025-05-01', periodEnd: '2025-11-30' }, // 40 元/亩
      { id: 'policy-2', unitSumInsuredCentsPerMu: 5000, status: '保障中', insuredMode: 'insured_roster', product: '政策性水稻完全成本保险', insuredObject: '水稻', premiumRate: 0.032, periodStart: '2025-05-01', periodEnd: '2025-11-30' }, // 50 元/亩
      { id: 'policy-hist', unitSumInsuredCentsPerMu: 4000, status: '已到期', insuredMode: 'single_insured' },
    ],
    parcelCoverages: [
      { insuredAreaMu: '100.0', insuredPartyId: 'party-a', policyId: 'policy-1' },
      { insuredAreaMu: '50.0', insuredPartyId: 'party-b', policyId: 'policy-2' },
      { insuredAreaMu: '25.5', insuredPartyId: 'party-a', policyId: 'policy-1' },
      { insuredAreaMu: '999.0', insuredPartyId: 'party-hist', policyId: 'policy-hist' }, // 历史覆盖必须剔除
    ],
    enrollmentItems: [
      { insuredPartyId: 'party-c' },
      { insuredPartyId: 'party-a' },
    ],
    parties: [{ id: 'party-coop', partyType: '村集体' }, { id: 'party-a', partyType: '农户' }],
    ...overrides,
  }
}

describe('summarizePolicyFixture 敞口汇总（仅保障中）', () => {
  it('面积/保额只统计保障中覆盖，历史剔除；户数去重排除村集体', () => {
    const summary = summarizePolicyFixture(makeFixture())
    expect(summary.insuredAreaMu).toBe(175.5) // 100+50+25.5（999 历史剔除）
    expect(summary.sumInsuredYuan).toBe(7520) // 分 752000 = 100×4000+50×5000+25.5×4000
    expect(summary.householdCount).toBe(3) // {a, b, c}，村集体剔除
  })
  it('保单结构：保障中保单数/大户保单数/清单户数', () => {
    const summary = summarizePolicyFixture(makeFixture())
    expect(summary.policyCount).toBe(2)
    expect(summary.bigHolderPolicyCount).toBe(1) // 仅 single_insured 的 policy-1
    expect(summary.rosterHouseholdCount).toBe(2) // enrollmentItems 去重 {a, c}
  })
  it('保障参数与保障期：取首张保障中保单，inForce=true', () => {
    const summary = summarizePolicyFixture(makeFixture())
    expect(summary.product).toBe('政策性水稻完全成本保险')
    expect(summary.crop).toBe('水稻')
    expect(summary.unitSumInsuredYuanPerMu).toBe(40) // 4000 分 / 100
    expect(summary.premiumRate).toBe(0.032)
    expect(summary.periodStart).toBe('2025-05-01')
    expect(summary.periodEnd).toBe('2025-11-30')
    expect(summary.inForce).toBe(true)
  })
  it('无保障中保单：inForce=false，保障参数取最后一张保单', () => {
    const summary = summarizePolicyFixture(makeFixture({
      policies: [{ id: 'p-old', unitSumInsuredCentsPerMu: 8000, status: '已到期', premiumRate: 0.03, periodStart: '2024-05-01', periodEnd: '2024-11-30' }],
    }))
    expect(summary.inForce).toBe(false)
    expect(summary.unitSumInsuredYuanPerMu).toBe(80)
    expect(summary.premiumRate).toBe(0.03)
  })
  it('空 fixture 全 0 不报错', () => {
    expect(summarizePolicyFixture({})).toEqual({
      insuredAreaMu: 0, sumInsuredYuan: 0, householdCount: 0, policyCount: 0, bigHolderPolicyCount: 0, rosterHouseholdCount: 0,
      product: null, crop: null, unitSumInsuredYuanPerMu: 0, premiumRate: 0, periodStart: null, periodEnd: null, inForce: false,
    })
  })
  it('字符串/缺失字段容错', () => {
    const summary = summarizePolicyFixture(makeFixture({
      parcelCoverages: [{ insuredAreaMu: 'not-a-number', insuredPartyId: '', policyId: 'policy-1' }],
    }))
    expect(summary.insuredAreaMu).toBe(0)
    expect(summary.sumInsuredYuan).toBe(0)
    expect(summary.householdCount).toBe(2) // 清单户 {a, c} 仍计入（与覆盖无关）
  })
})

describe('policyFixtureUrl', () => {
  it('龙江村沿用 policy-v1.json，其余带村码', () => {
    expect(policyFixtureUrl('330604102014')).toBe('/business/policy-v1.json')
    expect(policyFixtureUrl('330604102016')).toBe('/business/policy-330604102016.json')
    expect(policyFixtureUrl('330683104307')).toBe('/business/policy-330683104307.json')
  })
})

describe('loadPolicySummaries 并行加载', () => {
  it('13 村全部汇总（mock fetch 按 URL 返回 fixture）', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => makeFixture({ parcelCoverages: [{ insuredAreaMu: '10.0', insuredPartyId: 'p', policyId: 'policy-1' }] }),
    }) as unknown as Response)
    const result = await loadPolicySummaries({ fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.size).toBe(13)
    expect(fetchImpl).toHaveBeenCalledTimes(13)
    expect(result.get('330604102016')?.insuredAreaMu).toBe(10)
    expect(result.get('330604102014')?.sumInsuredYuan).toBe(400) // 10亩 × 40元/亩
    for (const code of INSURED_VILLAGE_CODES) expect(result.has(code)).toBe(true)
  })
  it('单文件失败降级为 0 汇总，不阻断其余', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('policy-v1.json')) return { ok: false } as unknown as Response // 龙江村失败
      return { ok: true, json: async () => makeFixture({ parcelCoverages: [{ insuredAreaMu: '5', insuredPartyId: 'p', policyId: 'policy-1' }] }) } as unknown as Response
    })
    const result = await loadPolicySummaries({ fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.get('330604102014')).toEqual({
      code: '330604102014', insuredAreaMu: 0, sumInsuredYuan: 0, householdCount: 0, policyCount: 0, bigHolderPolicyCount: 0, rosterHouseholdCount: 0,
      product: null, crop: null, unitSumInsuredYuanPerMu: 0, premiumRate: 0, periodStart: null, periodEnd: null, inForce: false,
    })
    expect(result.get('330604102016')?.insuredAreaMu).toBe(5)
  })
})
