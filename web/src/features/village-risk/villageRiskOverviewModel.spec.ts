import { describe, expect, it } from 'vitest'
import { buildVillageRiskOverviewModel, peakLabel, type VillageRiskOverviewInput } from './villageRiskOverviewModel'
import type { VillageRiskResult } from './villageRiskData'
import type { VillagePolicySummary } from './villagePolicySummary'

const DAYS = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']

function result(level: number, peakMm: number, peakDayIndex: number): VillageRiskResult {
  return {
    level: level as VillageRiskResult['level'],
    peak: { level: level as 0 | 1 | 2 | 3, mm: peakMm, dayIndex: peakDayIndex },
    consecutive: false,
    precipSignal: 0, typhoonSignal: 0,
    typhoonPathDistanceKm: null, typhoonWindCovered: false,
    typhoonName: null, typhoonCoverageHours: null,
    alarmSignal: 0, matchedEvent: null, matchedSeverity: null,
  }
}

function summary(area: number, sumInsured: number, households: number): VillagePolicySummary {
  return { code: 'x', insuredAreaMu: area, sumInsuredYuan: sumInsured, householdCount: households, policyCount: 1, bigHolderPolicyCount: 1, rosterHouseholdCount: households, bigHolderStat: { householdCount: 0, insuredAreaMu: 0, sumInsuredYuan: 0 }, rosterStat: { householdCount: 0, insuredAreaMu: 0, sumInsuredYuan: 0 }, periodStart: null, periodEnd: null, inForce: true }
}

function build(villages: Array<{ code: string; name: string; result: VillageRiskResult }>, policies: Map<string, VillagePolicySummary>) {
  return buildVillageRiskOverviewModel({ villages, policies, days: DAYS, updatedAt: '2026-08-10 08:12:00+08:00' } satisfies VillageRiskOverviewInput)
}

describe('peakLabel 峰值文案', () => {
  it('8/13 大暴雨 112mm（日期+类型+雨量）', () => {
    const p = peakLabel(DAYS, { level: 3, mm: 112, dayIndex: 3 })
    expect(p.label).toBe('8/13 大暴雨 112mm')
    expect(p.dateLabel).toBe('8/13')
  })
  it('去前导零日期 + 分级名', () => {
    expect(peakLabel(DAYS, { level: 2, mm: 60, dayIndex: 0 }).label).toBe('8/10 暴雨 60mm')
    expect(peakLabel(DAYS, { level: 1, mm: 30, dayIndex: 5 }).label).toBe('8/15 大雨 30mm')
  })
})

describe('buildVillageRiskOverviewModel 统计与列表', () => {
  const villages = [
    { code: 'a', name: '甲村', result: result(3, 112, 3) },
    { code: 'b', name: '乙村', result: result(2, 60, 1) },
    { code: 'c', name: '丙村', result: result(3, 98, 2) },
    { code: 'd', name: '丁村', result: result(1, 30, 0) }, // 低风险不入列
    { code: 'e', name: '戊村', result: result(0, 0, 0) },
  ]
  const policies = new Map<string, VillagePolicySummary>([
    ['a', summary(640, 18_900_000, 42)],
    ['b', summary(520, 14_300_000, 35)],
    ['c', summary(480, 12_100_000, 28)],
    ['d', summary(300, 6_000_000, 20)],
    ['e', summary(200, 4_000_000, 15)],
  ])

  it('统计：高 2 中 1；受影响面积/保额/户数 = 高中村合计（低/灰不入）', () => {
    const model = build(villages, policies)
    expect(model.highCount).toBe(2)
    expect(model.midCount).toBe(1)
    expect(model.totalInsuredAreaMu).toBe(640 + 520 + 480)
    expect(model.totalSumInsuredYuan).toBe(18_900_000 + 14_300_000 + 12_100_000)
    expect(model.totalHouseholdCount).toBe(42 + 35 + 28)
  })

  it('列表：仅高/中，等级降序→面积降序；行含峰值+敞口', () => {
    const model = build(villages, policies)
    expect(model.rows.map((r) => r.code)).toEqual(['a', 'c', 'b']) // 高(112) → 高(98) → 中
    const rowA = model.rows[0]!
    expect(rowA.villageName).toBe('甲村')
    expect(rowA.levelText).toBe('高风险')
    expect(rowA.peakLabel).toBe('8/13 大暴雨 112mm')
    expect(rowA.insuredAreaMu).toBe(640)
    expect(rowA.sumInsuredYuan).toBe(18_900_000)
    expect(rowA.householdCount).toBe(42)
    expect(rowA.policyAvailable).toBe(true)
  })

  it('保单缺失村：敞口 0 且 policyAvailable=false；全部缺失 → policyAllFailed', () => {
    const noPolicies = new Map<string, VillagePolicySummary>()
    const model = build(villages, noPolicies)
    expect(model.policyAllFailed).toBe(true)
    expect(model.rows[0]!.insuredAreaMu).toBe(0)
    expect(model.rows[0]!.policyAvailable).toBe(false)
  })

  it('无高/中风险 → 空列表与 0 统计', () => {
    const quiet = build(
      [{ code: 'd', name: '丁村', result: result(1, 30, 0) }, { code: 'e', name: '戊村', result: result(0, 0, 0) }],
      policies,
    )
    expect(quiet.highCount).toBe(0)
    expect(quiet.midCount).toBe(0)
    expect(quiet.rows).toHaveLength(0)
    expect(quiet.totalInsuredAreaMu).toBe(0)
  })
})
