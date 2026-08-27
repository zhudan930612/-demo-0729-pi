import { describe, expect, it } from 'vitest'
import type { DisasterWarnings, DisasterPrecip, DisasterUnderwriting, DisasterRiskModel } from './types'
import {
  warnedVillagesAtNode, sortWarnedVillages, warningOverview, buildCountyBadges,
  future24RainByGrid, cumulativeRainByGrid, riskCoefficient, lossRateForLevel,
  computeLossSummary, aiAdviceForLevel, WARNING_STATUS_LABEL,
} from './disasterWarningSelectors'

const villages = [
  { code: '330382101001', name: 'A村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.0, lat: 28.2, seatSource: 'seat' as const },
  { code: '330382101002', name: 'B村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.05, lat: 28.25, seatSource: 'seat' as const },
  { code: '330282101001', name: 'C村', cityCode: '330200', countyCode: '330282', townshipCode: '330282101000', lon: 121.4, lat: 29.9, seatSource: 'name' as const },
]

const warnings: DisasterWarnings = {
  schemaVersion: 1, thresholds: { low: 130, mid: 160, high: 185 }, hysteresisNodes: 2,
  nodeTimes: ['2026-07-09 02:00:00', '2026-07-09 05:00:00'],
  villages,
  nodes: [
    { i: 0, w: [[0, 1]] },
    { i: 1, w: [[0, 3], [1, 2], [2, 1]] },
  ],
}

const precip: DisasterPrecip = {
  schemaVersion: 1, model: 'ERA5', aggregateFrom: '2026-07-09 00:00:00',
  nodeTimes: ['2026-07-09 02:00:00', '2026-07-09 05:00:00'],
  grid: [
    { lat: 28.2, lon: 121.0, cum: [0.0, 15.5] },
    { lat: 28.25, lon: 121.05, cum: [0.0, 20.0] },
    { lat: 29.9, lon: 121.4, cum: [0.0, 5.0] },
  ],
}

const underwriting: DisasterUnderwriting = {
  schemaVersion: 1, seed: 'x', sumInsuredPerMu: 1250, targetTotalMu: 100000,
  villages: [
    { code: '330382101001', name: 'A村', insuredAreaMu: 100, householdCount: 10, sumInsuredYuan: 125000, source: 'mock' },
    { code: '330382101002', name: 'B村', insuredAreaMu: 200, householdCount: 20, sumInsuredYuan: 250000, source: 'mock' },
    { code: '330282101001', name: 'C村', insuredAreaMu: 50, householdCount: 5, sumInsuredYuan: 62500, source: 'mock' },
  ],
}

const riskModel: DisasterRiskModel = {
  schemaVersion: 1,
  riskLevelFromCumRainMm: [
    { max: 50, level: 0, name: '无', coefficient: 0.2 },
    { min: 50, max: 100, level: 1, name: '低', coefficient: 0.4 },
    { min: 100, max: 150, level: 2, name: '中', coefficient: 0.7 },
    { min: 150, level: 3, name: '高', coefficient: 1.0 },
  ],
  lossRateByWarningLevel: [
    { level: 1, name: '低', lossRate: 0.03 },
    { level: 2, name: '中', lossRate: 0.08 },
    { level: 3, name: '高', lossRate: 0.15 },
  ],
  formula: 'x',
}

describe('disasterWarningSelectors', () => {
  it('warnedVillagesAtNode 返回当前节点预警村（等级 1~3），无风险村不入表', () => {
    expect(warnedVillagesAtNode(warnings, 0)).toEqual([{ villageIndex: 0, village: villages[0], level: 1 }])
    const node1 = warnedVillagesAtNode(warnings, 1)
    expect(node1).toHaveLength(3)
    expect(node1.map((e) => e.level)).toEqual([3, 2, 1])
    expect(warnedVillagesAtNode(warnings, 9)).toEqual([])
  })

  it('sortWarnedVillages 按等级（高→低）→ 预报雨量降序', () => {
    const entries = warnedVillagesAtNode(warnings, 1)
    const sorted = sortWarnedVillages(entries, (idx) => future24RainByGrid(precip, villages[idx]!.lon, villages[idx]!.lat, 1))
    expect(sorted.map((e) => e.village.code)).toEqual(['330382101001', '330382101002', '330282101001'])
  })

  it('warningOverview 分等级计数（R3-12）', () => {
    const overview = warningOverview(warnedVillagesAtNode(warnings, 1))
    expect(overview).toEqual({ total: 3, high: 1, mid: 1, low: 1 })
  })

  it('状态标签：中/高=待处理，低=待观察（R3-13）', () => {
    expect(WARNING_STATUS_LABEL[1]).toBe('待观察')
    expect(WARNING_STATUS_LABEL[2]).toBe('待处理')
    expect(WARNING_STATUS_LABEL[3]).toBe('待处理')
  })

  it('aiAdviceForLevel 按等级生成建议文案（R3-14）', () => {
    expect(aiAdviceForLevel(3)).toContain('抢收')
    expect(aiAdviceForLevel(2)).toContain('加固')
    expect(aiAdviceForLevel(1)).toContain('关注')
  })

  it('future24RainByGrid 吸附最近格点计算未来 24h（cum[i+24]-cum[i]）', () => {
    expect(future24RainByGrid(precip, 121.0, 28.2, 0)).toBe(15.5)
    expect(future24RainByGrid(precip, 121.0, 28.2, 1)).toBe(0) // 末节点截断
  })

  it('buildCountyBadges 按区县聚合中/高风险，低风险不计徽标（R3-19）', () => {
    const seats = new Map<string, [number, number]>([['330382', [121.03, 28.21]], ['330282', [121.4, 29.9]]])
    const badges = buildCountyBadges(warnedVillagesAtNode(warnings, 1), seats)
    // A(330382,高) + B(330382,中) → 1 个徽标 count=2；C(330282,低) 不上图
    expect(badges).toHaveLength(1)
    const b382 = badges.find((b) => b.countyCode === '330382')!
    expect(b382.count).toBe(2)
    expect(b382.maxLevel).toBe(3)
    expect(b382.lon).toBe(121.03)
    expect(badges.find((b) => b.countyCode === '330282')).toBeUndefined()
  })

  it('riskCoefficient / lossRateForLevel 按口径映射（R4-5）', () => {
    expect(riskCoefficient(riskModel, 10)).toBe(0.2)
    expect(riskCoefficient(riskModel, 60)).toBe(0.4)
    expect(riskCoefficient(riskModel, 120)).toBe(0.7)
    expect(riskCoefficient(riskModel, 160)).toBe(1.0)
    expect(lossRateForLevel(riskModel, 1)).toBe(0.03)
    expect(lossRateForLevel(riskModel, 2)).toBe(0.08)
    expect(lossRateForLevel(riskModel, 3)).toBe(0.15)
  })

  it('computeLossSummary 按 承保×风险系数×损失率 汇总（R4-1/R4-4）', () => {
    // A村 高(3) 损失率0.15；过程累计 15.5mm → 风险系数 0.2
    // B村 中(2) 损失率0.08；过程累计 20mm → 0.2
    // C村 低(1) 损失率0.03；过程累计 5mm → 0.2
    const summary = computeLossSummary({ entries: warnedVillagesAtNode(warnings, 1), precip, underwriting, riskModel, nodeIndex: 1 })
    expect(summary.households).toBe(35)
    const expectedArea = 100 * 0.2 * 0.15 + 200 * 0.2 * 0.08 + 50 * 0.2 * 0.03
    expect(summary.areaWanMu).toBeCloseTo(expectedArea / 10000, 6)
    const expectedAmount = 125000 * 0.2 * 0.15 + 250000 * 0.2 * 0.08 + 62500 * 0.2 * 0.03
    expect(summary.amountWanYuan).toBeCloseTo(expectedAmount / 10000, 6)
  })

  it('computeLossSummary 无预警村 → 0（R4-1 空态）', () => {
    const summary = computeLossSummary({ entries: [], precip, underwriting, riskModel, nodeIndex: 0 })
    expect(summary).toEqual({ areaWanMu: 0, households: 0, amountWanYuan: 0 })
  })

  it('cumulativeRainByGrid 取节点过程累计（风险系数口径，非未来24h）', () => {
    expect(cumulativeRainByGrid(precip, 121.0, 28.2, 1)).toBe(15.5)
    expect(cumulativeRainByGrid(precip, 121.4, 29.9, 1)).toBe(5.0)
  })
})
