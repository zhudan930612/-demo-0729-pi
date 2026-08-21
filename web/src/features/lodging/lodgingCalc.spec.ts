import { describe, expect, it } from 'vitest'
import {
  compensationRatio,
  computeCompensation,
  parcelDamageSeverity,
  computeRegionSeverity,
  severitySortWeight,
  aggregateByLevel,
  sortRegionResults,
  type ParcelDamage,
} from './lodgingCalc'

// ========== 赔付比例 ==========

describe('compensationRatio', () => {
  it('returns 0 for damage rate 0%', () => {
    expect(compensationRatio(0)).toBe(0)
  })

  it('returns 50% for damage rate (0%, 30%)', () => {
    expect(compensationRatio(1)).toBe(0.5)
    expect(compensationRatio(15)).toBe(0.5)
    expect(compensationRatio(29.99)).toBe(0.5)
  })

  it('returns 80% for damage rate [30%, 60%)', () => {
    expect(compensationRatio(30)).toBe(0.8)
    expect(compensationRatio(45)).toBe(0.8)
    expect(compensationRatio(59.99)).toBe(0.8)
  })

  it('returns 100% for damage rate [60%, 100%]', () => {
    expect(compensationRatio(60)).toBe(1)
    expect(compensationRatio(80)).toBe(1)
    expect(compensationRatio(100)).toBe(1)
  })
})

// ========== 赔付金额 ==========

describe('computeCompensation', () => {
  it('returns 0 for damage rate 0%', () => {
    expect(computeCompensation(10, 1250, 0)).toBe(0)
  })

  it('returns 0 for damage area 0', () => {
    expect(computeCompensation(0, 1250, 50)).toBe(0)
  })

  it('calculates compensation for light damage (50% ratio)', () => {
    // 10亩 × ¥1250/亩 × 50% = ¥6,250
    expect(computeCompensation(10, 1250, 15)).toBe(6250)
  })

  it('calculates compensation for medium damage (80% ratio)', () => {
    // 10亩 × ¥1250/亩 × 80% = ¥10,000
    expect(computeCompensation(10, 1250, 45)).toBe(10000)
  })

  it('calculates compensation for heavy damage (100% ratio)', () => {
    // 12.5亩 × ¥1250/亩 × 100% = ¥15,625
    expect(computeCompensation(12.5, 1250, 80)).toBe(15625)
  })

  it('returns 0 when sumInsured is 0', () => {
    expect(computeCompensation(10, 0, 50)).toBe(0)
  })
})

// ========== 地块受损程度 ==========

describe('parcelDamageSeverity', () => {
  it('returns none for 0%', () => {
    expect(parcelDamageSeverity(0)).toBe('none')
  })

  it('returns light for (0%, 30%)', () => {
    expect(parcelDamageSeverity(1)).toBe('light')
    expect(parcelDamageSeverity(29.99)).toBe('light')
  })

  it('returns medium for [30%, 60%)', () => {
    expect(parcelDamageSeverity(30)).toBe('medium')
    expect(parcelDamageSeverity(59.99)).toBe('medium')
  })

  it('returns heavy for [60%, 100%]', () => {
    expect(parcelDamageSeverity(60)).toBe('heavy')
    expect(parcelDamageSeverity(100)).toBe('heavy')
  })
})

// ========== 区域受损程度 ==========

describe('computeRegionSeverity', () => {
  it('returns none for 0%', () => {
    expect(computeRegionSeverity(0)).toBe('none')
  })

  it('returns light for < 30%', () => {
    expect(computeRegionSeverity(1)).toBe('light')
    expect(computeRegionSeverity(29.99)).toBe('light')
  })

  it('returns medium for [30%, 60%)', () => {
    expect(computeRegionSeverity(30)).toBe('medium')
    expect(computeRegionSeverity(59.99)).toBe('medium')
  })

  it('returns heavy for >= 60%', () => {
    expect(computeRegionSeverity(60)).toBe('heavy')
    expect(computeRegionSeverity(100)).toBe('heavy')
  })
})

// ========== 排序权重 ==========

describe('severitySortWeight', () => {
  it('heavy has lowest weight (sorted first)', () => {
    expect(severitySortWeight('heavy')).toBeLessThan(severitySortWeight('medium'))
    expect(severitySortWeight('medium')).toBeLessThan(severitySortWeight('light'))
    expect(severitySortWeight('light')).toBeLessThan(severitySortWeight('none'))
  })
})

// ========== 逐级汇总 ==========

describe('aggregateByLevel', () => {
  const parcels: ParcelDamage[] = [
    { parcelId: '1001', villageCode: '330683100200', areaMu: 10, sumInsured: 1250, damageAreaMu: 5, damageRate: 50, insuredPartyId: 'party-a' },
    { parcelId: '1002', villageCode: '330683100200', areaMu: 8, sumInsured: 1250, damageAreaMu: 8, damageRate: 100, insuredPartyId: 'party-b' },
    { parcelId: '1003', villageCode: '330683100201', areaMu: 12, sumInsured: 1250, damageAreaMu: 0, damageRate: 0, insuredPartyId: 'party-c' },
    { parcelId: '1004', villageCode: '330683100200', areaMu: 6, sumInsured: 1250, damageAreaMu: 3, damageRate: 50, insuredPartyId: 'party-a' },
  ]

  it('aggregates by village level with correct damage area (actual damage)', () => {
    const result = aggregateByLevel(parcels, 'village')
    expect(result).toHaveLength(2)

    const v200 = result.find((r) => r.code === '330683100200')
    expect(v200).toBeDefined()
    // totalInsuredAreaMu = 10 + 8 + 6 = 24
    expect(v200!.totalInsuredAreaMu).toBe(24)
    // damagedAreaMu = 5 + 8 + 3 = 16 (actual damage areas)
    expect(v200!.damagedAreaMu).toBe(16)
    // householdCount: party-a, party-b (party-a counted once despite 2 parcels) = 2
    expect(v200!.householdCount).toBe(2)
    // damageRate = 16/24 * 100 = 66.67%
    expect(v200!.damageRate).toBe(66.67)
    expect(v200!.severity).toBe('heavy')
  })

  it('excludes undamaged parcels from damage stats', () => {
    const result = aggregateByLevel(parcels, 'village')
    const v201 = result.find((r) => r.code === '330683100201')
    expect(v201).toBeDefined()
    expect(v201!.totalInsuredAreaMu).toBe(12)
    expect(v201!.damagedAreaMu).toBe(0)
    expect(v201!.householdCount).toBe(0)
    expect(v201!.damageRate).toBe(0)
    expect(v201!.severity).toBe('none')
  })

  it('aggregates by township level', () => {
    const result = aggregateByLevel(parcels, 'township')
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('330683100')
    // totalInsuredAreaMu = 10 + 8 + 12 + 6 = 36
    expect(result[0].totalInsuredAreaMu).toBe(36)
    // damagedAreaMu = 5 + 8 + 0 + 3 = 16 (actual damage)
    expect(result[0].damagedAreaMu).toBe(16)
    // householdCount: party-a, party-b (party-c not counted, undamaged) = 2
    expect(result[0].householdCount).toBe(2)
    // damageRate = 16/36 * 100 = 44.44%
    expect(result[0].damageRate).toBe(44.44)
  })

  it('aggregates by county level', () => {
    const result = aggregateByLevel(parcels, 'county')
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('330683')
  })

  it('aggregates by city level', () => {
    const result = aggregateByLevel(parcels, 'city')
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('3306')
  })

  it('aggregates by province level', () => {
    const result = aggregateByLevel(parcels, 'province')
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('33')
  })
})

// ========== 区域排序 ==========

describe('sortRegionResults', () => {
  const nameMap = new Map<string, string>([
    ['A', 'Alpha'],
    ['B', 'Beta'],
    ['C', 'Charlie'],
    ['D', 'Delta'],
  ])

  it('sorts by severity first (heavy > medium > light > none)', () => {
    // Create mock results with different severities (thresholds: 30/60)
    const mock = [
      { code: 'A', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 5, householdCount: 1, damageRate: 5, severity: 'light' as const },
      { code: 'B', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 65, householdCount: 1, damageRate: 65, severity: 'heavy' as const },
      { code: 'C', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 45, householdCount: 1, damageRate: 45, severity: 'medium' as const },
      { code: 'D', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 0, householdCount: 0, damageRate: 0, severity: 'none' as const },
    ]
    const sorted = sortRegionResults(mock, nameMap)
    expect(sorted.map(r => r.code)).toEqual(['B', 'C', 'A', 'D'])
  })

  it('sorts by damage rate descending within same severity', () => {
    const mock = [
      { code: 'A', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 35, householdCount: 1, damageRate: 35, severity: 'medium' as const },
      { code: 'B', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 50, householdCount: 1, damageRate: 50, severity: 'medium' as const },
      { code: 'C', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 40, householdCount: 1, damageRate: 40, severity: 'medium' as const },
    ]
    const sorted = sortRegionResults(mock, nameMap)
    expect(sorted.map(r => r.code)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by name dictionary order when severity and rate are equal', () => {
    const mock = [
      { code: 'C', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 65, householdCount: 1, damageRate: 65, severity: 'heavy' as const },
      { code: 'A', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 65, householdCount: 1, damageRate: 65, severity: 'heavy' as const },
      { code: 'B', totalInsuredAreaMu: 100, totalCompensation: 0, damagedAreaMu: 65, householdCount: 1, damageRate: 65, severity: 'heavy' as const },
    ]
    const sorted = sortRegionResults(mock, nameMap)
    expect(sorted.map(r => r.code)).toEqual(['A', 'B', 'C'])
  })
})
