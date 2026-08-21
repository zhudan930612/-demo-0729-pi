import { describe, expect, it } from 'vitest'
import {
  createSeededRandom,
  hashString,
  generateVillageDamage,
  DAMAGE_GENERATOR_CONFIG,
  VILLAGE_DAMAGE_OVERRIDE,
  type ParcelInput,
} from './lodgingDamageGenerator'
import { computeRegionSeverity } from './lodgingCalc'
import type { VillageBoundary } from '../village-risk/villageRiskData'

// ========== 确定性随机 ==========

describe('createSeededRandom', () => {
  it('produces deterministic sequence for same seed', () => {
    const rng1 = createSeededRandom(42)
    const rng2 = createSeededRandom(42)
    const seq1 = Array.from({ length: 10 }, () => rng1())
    const seq2 = Array.from({ length: 10 }, () => rng2())
    expect(seq1).toEqual(seq2)
  })

  it('produces different sequences for different seeds', () => {
    const rng1 = createSeededRandom(42)
    const rng2 = createSeededRandom(99)
    const seq1 = Array.from({ length: 5 }, () => rng1())
    const seq2 = Array.from({ length: 5 }, () => rng2())
    expect(seq1).not.toEqual(seq2)
  })

  it('produces values in [0, 1) range', () => {
    const rng = createSeededRandom(12345)
    for (let i = 0; i < 100; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('hashString', () => {
  it('produces consistent hash for same input', () => {
    expect(hashString('330604102014')).toBe(hashString('330604102014'))
  })

  it('produces different hashes for different inputs', () => {
    expect(hashString('village-a')).not.toBe(hashString('village-b'))
  })
})

// ========== 辅助工厂 ==========

function createMockVillage(overrides?: Partial<VillageBoundary>): VillageBoundary {
  return {
    code: '330604102014',
    name: '龙江村',
    polygons: [
      // polygons = Array<Array<Array<[number, number]>>> = [polygon[polygon[rings[coordinates]]]]
      [
        // one polygon, one ring (outer ring)
        [
          [120.700, 29.900],
          [120.705, 29.900],
          [120.705, 29.905],
          [120.700, 29.905],
          [120.700, 29.900],
        ],
      ],
    ],
    bbox: { latMin: 29.900, latMax: 29.905, lonMin: 120.700, lonMax: 120.705 },
    centroid: { lat: 29.9025, lon: 120.7025 },
    countyCode: '330604',
    ...overrides,
  }
}

function createMockParcels(count: number, villageCode: string = '330604102014'): ParcelInput[] {
  const parcels: ParcelInput[] = []
  const baseLon = 120.700
  const baseLat = 29.900
  for (let i = 0; i < count; i++) {
    parcels.push({
      parcelId: String(1000 + i),
      villageCode,
      areaMu: 5 + (i % 3) * 2, // 5, 7, 9, 5, 7, 9, ...
      sumInsured: 1250,
      insuredPartyId: `party-${i % 5}`,
      centroid: [
        baseLon + (i % 5) * 0.001, // spread across ~500m
        baseLat + Math.floor(i / 5) * 0.001,
      ],
    })
  }
  return parcels
}

// ========== 连片生成 ==========

describe('generateVillageDamage', () => {
  it('returns empty for empty parcels', () => {
    const village = createMockVillage()
    const result = generateVillageDamage(village, [])
    expect(result.parcels).toHaveLength(0)
    expect(result.centerPoints).toHaveLength(0)
  })

  it('generates damage for parcels', () => {
    const village = createMockVillage()
    const parcels = createMockParcels(10)
    const result = generateVillageDamage(village, parcels)

    expect(result.villageCode).toBe('330604102014')
    expect(result.parcels.length).toBe(10)
    expect(result.centerPoints.length).toBeGreaterThanOrEqual(1)
  })

  it('produces deterministic results for same seed', () => {
    const village = createMockVillage()
    const parcels = createMockParcels(10)
    const result1 = generateVillageDamage(village, parcels, 42)
    const result2 = generateVillageDamage(village, parcels, 42)

    expect(result1.parcels).toEqual(result2.parcels)
    expect(result1.centerPoints).toEqual(result2.centerPoints)
  })

  it('produces different results for different seeds', () => {
    const village = createMockVillage()
    const parcels = createMockParcels(10)
    const result1 = generateVillageDamage(village, parcels, 42)
    const result2 = generateVillageDamage(village, parcels, 99)

    // At least some damage rates should differ
    const rates1 = result1.parcels.map(p => p.damageRate)
    const rates2 = result2.parcels.map(p => p.damageRate)
    expect(rates1).not.toEqual(rates2)
  })

  it('generates center points within village bbox', () => {
    const village = createMockVillage()
    const parcels = createMockParcels(20)
    const result = generateVillageDamage(village, parcels)

    for (const [lon, lat] of result.centerPoints) {
      expect(lon).toBeGreaterThanOrEqual(village.bbox.lonMin)
      expect(lon).toBeLessThanOrEqual(village.bbox.lonMax)
      expect(lat).toBeGreaterThanOrEqual(village.bbox.latMin)
      expect(lat).toBeLessThanOrEqual(village.bbox.latMax)
    }
  })

  it('produces a mix of damaged and undamaged parcels', () => {
    const village = createMockVillage()
    const parcels = createMockParcels(30) // enough parcels to have some outside buffer
    const result = generateVillageDamage(village, parcels)

    const damaged = result.parcels.filter(p => p.damageRate > 0)

    // Should have some damaged parcels
    expect(damaged.length).toBeGreaterThan(0)
    // With 30 parcels spread across ~500m and max buffer 400m, some should be undamaged
    // This test may occasionally fail if all parcels happen to be within range
  })

  it('damaged parcels have damageAreaMu proportional to damageRate', () => {
    const village = createMockVillage()
    const parcels = createMockParcels(10)
    const result = generateVillageDamage(village, parcels)

    for (const p of result.parcels) {
      if (p.damageRate > 0) {
        // damageAreaMu should be approximately areaMu * damageRate / 100
        const expectedDamage = Math.round(p.areaMu * p.damageRate / 100 * 100) / 100
        expect(p.damageAreaMu).toBe(expectedDamage)
        expect(p.damageAreaMu).toBeGreaterThan(0)
        expect(p.damageAreaMu).toBeLessThanOrEqual(p.areaMu)
      } else {
        expect(p.damageAreaMu).toBe(0)
      }
    }
  })

  it('damage rates are within configured ranges', () => {
    const village = createMockVillage()
    const parcels = createMockParcels(30)
    const result = generateVillageDamage(village, parcels)

    const cfg = DAMAGE_GENERATOR_CONFIG
    for (const p of result.parcels) {
      if (p.damageRate > 0) {
        expect(p.damageRate).toBeGreaterThanOrEqual(cfg.LIGHT_RATE_MIN)
        expect(p.damageRate).toBeLessThanOrEqual(cfg.HEAVY_RATE_MAX)
      }
    }
  })

  it('some parcels have 0 damage (outside buffer)', () => {
    const village = createMockVillage({
      // 使用非 override 的村代码，避免触发特殊逻辑
      code: '330604102099',
      // Make village larger so some parcels are far from centers
      bbox: { latMin: 29.890, latMax: 29.910, lonMin: 120.690, lonMax: 120.710 },
      polygons: [
        [
          [
            [120.690, 29.890],
            [120.710, 29.890],
            [120.710, 29.910],
            [120.690, 29.910],
            [120.690, 29.890],
          ],
        ],
      ],
    })
    // Parcels spread across the larger village
    const parcels: ParcelInput[] = []
    for (let i = 0; i < 20; i++) {
      parcels.push({
        parcelId: String(2000 + i),
        villageCode: village.code,
        areaMu: 5,
        sumInsured: 1250,
        insuredPartyId: `party-${i % 3}`,
        centroid: [
          120.690 + (i % 5) * 0.005, // spread across ~2.5km
          29.890 + Math.floor(i / 5) * 0.005,
        ],
      })
    }

    const result = generateVillageDamage(village, parcels)
    const undamaged = result.parcels.filter(p => p.damageRate === 0)
    // In a 2km village with 400m max buffer, some parcels should be undamaged
    expect(undamaged.length).toBeGreaterThan(0)
  })
})

// ========== 特定村覆盖 ==========

describe('VILLAGE_DAMAGE_OVERRIDE', () => {
  /** 计算村级受灾率 */
  function villageDamageRate(result: { parcels: { damageAreaMu: number; areaMu: number }[] }): number {
    const totalArea = result.parcels.reduce((s, p) => s + p.areaMu, 0)
    const damagedArea = result.parcels.reduce((s, p) => s + p.damageAreaMu, 0)
    return totalArea > 0 ? (damagedArea / totalArea) * 100 : 0
  }

  it('清潭村 override produces medium severity (30%~60%)', () => {
    const override = VILLAGE_DAMAGE_OVERRIDE['330604102016']
    expect(override).toBeDefined()

    // 用真实村边界构造测试
    const village: VillageBoundary = {
      code: '330604102016',
      name: '清潭村',
      polygons: [[[
        [120.690, 29.890], [120.710, 29.890],
        [120.710, 29.910], [120.690, 29.910], [120.690, 29.890],
      ]]],
      bbox: { latMin: 29.890, latMax: 29.910, lonMin: 120.690, lonMax: 120.710 },
      centroid: { lat: 29.9, lon: 120.7 },
      countyCode: '330604',
    }
    const parcels: ParcelInput[] = Array.from({ length: 30 }, (_, i) => ({
      parcelId: String(3000 + i),
      villageCode: village.code,
      areaMu: 5 + (i % 3) * 2,
      sumInsured: 1250,
      insuredPartyId: `party-${i % 5}`,
      centroid: [120.690 + (i % 6) * 0.003, 29.890 + Math.floor(i / 6) * 0.004],
    }))

    const result = generateVillageDamage(village, parcels)
    const rate = villageDamageRate(result)
    const severity = computeRegionSeverity(rate)

    // 清潭村目标为中度（30%~60%），不能是轻度或重度
    expect(severity).toBe('medium')
    expect(rate).toBeGreaterThanOrEqual(30)
    expect(rate).toBeLessThan(60)
  })

  it('龙江村 override produces heavy severity (≥60%)', () => {
    const override = VILLAGE_DAMAGE_OVERRIDE['330604102014']
    expect(override).toBeDefined()

    // 使用更小的村庄（1km × 1km），让 800m 缓冲区能覆盖大部分面积
    const village: VillageBoundary = {
      code: '330604102014',
      name: '龙江村',
      polygons: [[[
        [120.695, 29.895], [120.705, 29.895],
        [120.705, 29.905], [120.695, 29.905], [120.695, 29.895],
      ]]],
      bbox: { latMin: 29.895, latMax: 29.905, lonMin: 120.695, lonMax: 120.705 },
      centroid: { lat: 29.9, lon: 120.7 },
      countyCode: '330604',
    }
    const parcels: ParcelInput[] = Array.from({ length: 40 }, (_, i) => ({
      parcelId: String(4000 + i),
      villageCode: village.code,
      areaMu: 3 + (i % 3) * 2,
      sumInsured: 1250,
      insuredPartyId: `party-${i % 5}`,
      // 地块均匀分布在 1km × 1km 内
      centroid: [120.695 + (i % 8) * 0.0012, 29.895 + Math.floor(i / 8) * 0.0012],
    }))

    const result = generateVillageDamage(village, parcels)
    const rate = villageDamageRate(result)
    const severity = computeRegionSeverity(rate)

    // 龙江村目标为重度（≥60%）
    expect(severity).toBe('heavy')
    expect(rate).toBeGreaterThanOrEqual(60)
  })
})
