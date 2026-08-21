import { describe, expect, it } from 'vitest'
import {
  precipBracket,
  windBracket,
  typhoonDistanceBracket,
  computeDamageRate,
  compensationRatio,
  computeCompensation,
  aggregateByLevel,
  type ParcelDamage,
} from './lodgingCalc'

// ========== 信号分档 ==========

describe('precipBracket', () => {
  it('returns 0 for precipitation < 50mm', () => {
    expect(precipBracket(0)).toBe(0)
    expect(precipBracket(49.9)).toBe(0)
  })

  it('returns 30 for precipitation 50-100mm', () => {
    expect(precipBracket(50)).toBe(30)
    expect(precipBracket(99.9)).toBe(30)
  })

  it('returns 60 for precipitation 100-200mm', () => {
    expect(precipBracket(100)).toBe(60)
    expect(precipBracket(199.9)).toBe(60)
  })

  it('returns 100 for precipitation >= 200mm', () => {
    expect(precipBracket(200)).toBe(100)
    expect(precipBracket(500)).toBe(100)
  })
})

describe('windBracket', () => {
  it('returns 0 for wind level < 7', () => {
    expect(windBracket(0)).toBe(0)
    expect(windBracket(6)).toBe(0)
  })

  it('returns 30 for wind level 7-8', () => {
    expect(windBracket(7)).toBe(30)
    expect(windBracket(8)).toBe(30)
  })

  it('returns 60 for wind level 9-10', () => {
    expect(windBracket(9)).toBe(60)
    expect(windBracket(10)).toBe(60)
  })

  it('returns 100 for wind level >= 11', () => {
    expect(windBracket(11)).toBe(100)
    expect(windBracket(17)).toBe(100)
  })
})

describe('typhoonDistanceBracket', () => {
  it('returns null when no typhoon (distance is null)', () => {
    expect(typhoonDistanceBracket(null)).toBe(null)
  })

  it('returns 0 for distance >= 200km', () => {
    expect(typhoonDistanceBracket(200)).toBe(0)
    expect(typhoonDistanceBracket(500)).toBe(0)
  })

  it('returns 30 for distance 100-200km', () => {
    expect(typhoonDistanceBracket(100)).toBe(30)
    expect(typhoonDistanceBracket(199.9)).toBe(30)
  })

  it('returns 60 for distance 50-100km', () => {
    expect(typhoonDistanceBracket(50)).toBe(60)
    expect(typhoonDistanceBracket(99.9)).toBe(60)
  })

  it('returns 100 for distance < 50km', () => {
    expect(typhoonDistanceBracket(49.9)).toBe(100)
    expect(typhoonDistanceBracket(0)).toBe(100)
  })
})

// ========== 木桶原理 ==========

describe('computeDamageRate', () => {
  it('returns max of all signal brackets', () => {
    // precip=75mm→30%, wind=7→30%, typhoon=75km→60%, max=60
    expect(computeDamageRate({ precip: 75, wind: 7, typhoon: 75 })).toBe(60)
    // precip=250mm→100%, wind=7→30%, typhoon=null→skip, max=100
    expect(computeDamageRate({ precip: 250, wind: 7, typhoon: null })).toBe(100)
  })

  it('skips typhoon signal when null (no typhoon)', () => {
    // precip=75mm→30%, wind=9→60%, typhoon=null→skip, max=60
    expect(computeDamageRate({ precip: 75, wind: 9, typhoon: null })).toBe(60)
  })

  it('returns 0 when all signals are 0', () => {
    // precip=30mm→0%, wind=5→0%, typhoon=300km→0%, max=0
    expect(computeDamageRate({ precip: 30, wind: 5, typhoon: 300 })).toBe(0)
    // precip=30mm→0%, wind=5→0%, typhoon=null→skip, max=0
    expect(computeDamageRate({ precip: 30, wind: 5, typhoon: null })).toBe(0)
  })

  it('returns max when all signals present', () => {
    // precip=75mm→30%, wind=7→30%, typhoon=150km→30%, max=30
    expect(computeDamageRate({ precip: 75, wind: 7, typhoon: 150 })).toBe(30)
    // precip=150mm→60%, wind=12→100%, typhoon=150km→30%, max=100
    expect(computeDamageRate({ precip: 150, wind: 12, typhoon: 150 })).toBe(100)
  })
})

// ========== 赔付比例 ==========

describe('compensationRatio', () => {
  it('returns 50% for damage rate 0%', () => {
    expect(compensationRatio(0)).toBe(0.5)
  })

  it('returns 80% for damage rate 30%', () => {
    expect(compensationRatio(30)).toBe(0.8)
  })

  it('returns 100% for damage rate 60%', () => {
    expect(compensationRatio(60)).toBe(1)
  })

  it('returns 100% for damage rate 100%', () => {
    expect(compensationRatio(100)).toBe(1)
  })
})

// ========== 赔付金额 ==========

describe('computeCompensation', () => {
  it('returns 0 for damage rate 0% (no damage)', () => {
    // 即使赔付比例=50%，damageRate=0 视为无受损，赔付=0
    expect(computeCompensation(10, 1000, 0)).toBe(0)
  })

  it('calculates compensation correctly for 30% damage', () => {
    // 10亩 × 1000元/亩 × 80% = 8000元
    expect(computeCompensation(10, 1000, 30)).toBe(8000)
  })

  it('calculates compensation correctly for 60% damage', () => {
    // 10亩 × 1000元/亩 × 100% = 10000元
    expect(computeCompensation(10, 1000, 60)).toBe(10000)
  })

  it('calculates compensation correctly for 100% damage', () => {
    // 12.5亩 × 2800元/亩 × 100% = 35000元
    expect(computeCompensation(12.5, 2800, 100)).toBe(35000)
  })

  it('returns 0 when area is 0', () => {
    expect(computeCompensation(0, 1000, 100)).toBe(0)
  })

  it('returns 0 when sumInsured is 0', () => {
    expect(computeCompensation(10, 0, 100)).toBe(0)
  })
})

// ========== 逐级汇总 ==========

describe('aggregateByLevel', () => {
  const parcels: ParcelDamage[] = [
    { parcelId: '1001', villageCode: '330683100200', areaMu: 10, sumInsured: 1000, damageRate: 30 },
    { parcelId: '1002', villageCode: '330683100200', areaMu: 5, sumInsured: 500, damageRate: 60 },
    { parcelId: '1003', villageCode: '330683100201', areaMu: 8, sumInsured: 800, damageRate: 0 },
  ]

  it('aggregates by village level (full code)', () => {
    const result = aggregateByLevel(parcels, 'village')
    expect(result).toHaveLength(2)
    const v200 = result.find((r) => r.code === '330683100200')
    expect(v200).toBeDefined()
    expect(v200!.totalAreaMu).toBe(15)
    // parcel 1001: 10×1000×0.8=8000; parcel 1002: 5×500×1.0=2500; total=10500
    expect(v200!.totalCompensation).toBe(10500)
  })

  it('aggregates by township level (code prefix 9 digits)', () => {
    const result = aggregateByLevel(parcels, 'township')
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('330683100')
    expect(result[0].totalAreaMu).toBe(23)
  })

  it('aggregates by county level (code prefix 6 digits)', () => {
    const result = aggregateByLevel(parcels, 'county')
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('330683')
  })

  it('aggregates by city level (code prefix 4 digits)', () => {
    const result = aggregateByLevel(parcels, 'city')
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('3306')
  })

  it('aggregates by province level (code prefix 2 digits)', () => {
    const result = aggregateByLevel(parcels, 'province')
    expect(result).toHaveLength(1)
    expect(result[0].code).toBe('33')
  })

  it('excludes parcels with 0 damage from compensation total but includes in area', () => {
    const result = aggregateByLevel(parcels, 'village')
    const v201 = result.find((r) => r.code === '330683100201')
    expect(v201!.totalAreaMu).toBe(8)
    expect(v201!.totalCompensation).toBe(0)
  })
})
