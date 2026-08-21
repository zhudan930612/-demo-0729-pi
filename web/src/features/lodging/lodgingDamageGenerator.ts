/**
 * 水稻倒伏评估 —— 空间连片受灾数据生成器（v2.0 需求 §3.6）
 *
 * 算法：
 * 1. 每个受灾村随机生成 2~4 个灾害中心点（落在村域范围内）
 * 2. 以每个中心点做 Turf.js buffer，半径 150~400 米
 * 3. 缓冲区内的地块按距中心点的远近分档：
 *    - 0~150m：重度（受损率 60%~100%）
 *    - 150~250m：中度（受损率 30%~60%）
 *    - 250~400m：轻度（受损率 5%~30%）
 * 4. 缓冲区外的地块不受灾（damageAreaMu = 0）
 * 5. 各村受灾比例：随机 10%~60% 的参保面积受灾
 *
 * 参数全部可配置，使用确定性随机（seed）保证一致性。
 */

import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers'
import { distance as turfDistance } from '@turf/distance'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import type { Feature, Polygon, MultiPolygon } from 'geojson'
import type { VillageBoundary } from '../village-risk/villageRiskData'

// ========== 可配置常量 ==========

/** 连片生成参数 */
export const DAMAGE_GENERATOR_CONFIG = {
  /** 每村灾害中心点数量范围 */
  CENTER_COUNT_MIN: 2,
  CENTER_COUNT_MAX: 4,
  /** 缓冲区最大半径（米） */
  BUFFER_RADIUS_MAX_M: 400,
  /** 重度圈半径（米）：0~150m → 重度 */
  HEAVY_RADIUS_M: 150,
  /** 中度圈外半径（米）：150~250m → 中度 */
  MEDIUM_RADIUS_M: 250,
  // 250~400m → 轻度（由 BUFFER_RADIUS_MAX_M 决定外圈）
  /** 重度受损率范围 */
  HEAVY_RATE_MIN: 60,
  HEAVY_RATE_MAX: 100,
  /** 中度受损率范围 */
  MEDIUM_RATE_MIN: 30,
  MEDIUM_RATE_MAX: 60,
  /** 轻度受损率范围 */
  LIGHT_RATE_MIN: 5,
  LIGHT_RATE_MAX: 30,
  /** 各村受灾比例范围（拉大差异，使区县/乡镇级有轻中重区分） */
  DAMAGE_RATIO_MIN: 0.05,
  DAMAGE_RATIO_MAX: 0.80,
  /** 随机点生成最大尝试次数 */
  MAX_POINT_ATTEMPTS: 200,
} as const

/**
 * 特定村的演示数据覆盖（用于控制演示效果）。
 * targetDamageRatio: 目标村级受灾比例（0~1），生成器会缩放各地块的 damageRate 使整体受灾率逼近该值。
 * 受损程度分档：< 30% 轻度 / [30%, 60%) 中度 / ≥ 60% 重度
 */
export const VILLAGE_DAMAGE_OVERRIDE: Record<string, { targetDamageRatio: number }> = {
  // 清潭村 → 中度受损（目标 45%，远离 30% 阈值）
  '330604102016': { targetDamageRatio: 0.45 },
  // 龙江村 → 重度受损（目标 85%，远离 60% 阈值）
  '330604102014': { targetDamageRatio: 0.85 },
}

// ========== 确定性随机数生成器 ==========

/** 简易 mulberry32 伪随机数生成器（基于 seed） */
export function createSeededRandom(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 从字符串生成数值 seed */
export function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  return hash
}

/** 在 [min, max] 范围内生成随机整数 */
function randomInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

/** 在 [min, max] 范围内生成随机浮点数 */
function randomFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min
}

// ========== 空间工具 ==========

/** 将 VillageBoundary 的多边形转换为 Turf.js 可用的 GeoJSON 多边形 */
function villageToGeoJSONPolygon(village: VillageBoundary): Feature<Polygon | MultiPolygon> {
  // VillageBoundary.polygons: Array<Array<Array<[number, number]>>>
  // 外层 = 多个多边形, 中层 = 环（第一个是外环，后面是孔洞）, 内层 = 坐标点 [lon, lat]
  if (village.polygons.length === 1) {
    const coords = village.polygons[0].map(ring =>
      ring.map(([lon, lat]) => [lon, lat] as [number, number])
    )
    return turfPolygon(coords)
  }
  // 多个多边形 → MultiPolygon
  const multiCoords = village.polygons.map(polygon =>
    polygon.map(ring =>
      ring.map(([lon, lat]) => [lon, lat] as [number, number])
    )
  )
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: multiCoords,
    },
  }
}

/** 在村域范围内生成随机点（在 bbox 内随机采样，检查是否在多边形内） */
function randomPointInVillage(
  village: VillageBoundary,
  villageGeo: Feature<Polygon | MultiPolygon>,
  rng: () => number,
): [number, number] | null {
  const { lonMin, lonMax, latMin, latMax } = village.bbox
  for (let i = 0; i < DAMAGE_GENERATOR_CONFIG.MAX_POINT_ATTEMPTS; i++) {
    const lon = randomFloat(rng, lonMin, lonMax)
    const lat = randomFloat(rng, latMin, latMax)
    const pt = turfPoint([lon, lat])
    if (booleanPointInPolygon(pt, villageGeo)) {
      return [lon, lat]
    }
  }
  // 退化：使用村域质心
  return [village.centroid.lon, village.centroid.lat]
}

// ========== 核心生成逻辑 ==========

/** 地块输入（从保单数据提取） */
export interface ParcelInput {
  parcelId: string
  villageCode: string
  areaMu: number
  sumInsured: number
  insuredPartyId?: string
  /** 地块质心 [lon, lat]，用于距离计算 */
  centroid: [number, number]
}

/** 单个地块的受灾结果 */
export interface ParcelDamageOutput {
  parcelId: string
  villageCode: string
  areaMu: number
  sumInsured: number
  insuredPartyId?: string
  /** 受损面积（亩）= areaMu × damageRate */
  damageAreaMu: number
  /** 受损率（连续值 0~100%） */
  damageRate: number
}

/** 单个村的受灾生成结果 */
export interface VillageDamageResult {
  villageCode: string
  parcels: ParcelDamageOutput[]
  centerPoints: [number, number][]
}

/** 距离分档，返回受损率范围 [min, max]（百分比） */
function distanceBracket(distanceM: number): { min: number; max: number } | null {
  const cfg = DAMAGE_GENERATOR_CONFIG
  if (distanceM <= cfg.HEAVY_RADIUS_M) {
    return { min: cfg.HEAVY_RATE_MIN, max: cfg.HEAVY_RATE_MAX }
  }
  if (distanceM <= cfg.MEDIUM_RADIUS_M) {
    return { min: cfg.MEDIUM_RATE_MIN, max: cfg.MEDIUM_RATE_MAX }
  }
  if (distanceM <= cfg.BUFFER_RADIUS_MAX_M) {
    return { min: cfg.LIGHT_RATE_MIN, max: cfg.LIGHT_RATE_MAX }
  }
  return null // 超出缓冲区
}

/** 扩展距离分档（override 村用），缓冲区半径翻倍 */
function extendedDistanceBracket(distanceM: number, maxRadius: number): { min: number; max: number } | null {
  const cfg = DAMAGE_GENERATOR_CONFIG
  // 按比例扩展各圈半径
  const scale = maxRadius / cfg.BUFFER_RADIUS_MAX_M  // 2x for 800m
  const heavyR = cfg.HEAVY_RADIUS_M * scale
  const mediumR = cfg.MEDIUM_RADIUS_M * scale

  if (distanceM <= heavyR) {
    return { min: cfg.HEAVY_RATE_MIN, max: cfg.HEAVY_RATE_MAX }
  }
  if (distanceM <= mediumR) {
    return { min: cfg.MEDIUM_RATE_MIN, max: cfg.MEDIUM_RATE_MAX }
  }
  if (distanceM <= maxRadius) {
    return { min: cfg.LIGHT_RATE_MIN, max: cfg.LIGHT_RATE_MAX }
  }
  return null // 超出缓冲区
}

/**
 * 为单个村生成连片受灾数据。
 *
 * @param village 村边界数据
 * @param parcels 该村内的参保地块列表
 * @param globalSeed 全局种子（用于确定性随机）
 */
export function generateVillageDamage(
  village: VillageBoundary,
  parcels: ParcelInput[],
  globalSeed: number = 20260821,
): VillageDamageResult {
  if (parcels.length === 0) {
    return { villageCode: village.code, parcels: [], centerPoints: [] }
  }

  const cfg = DAMAGE_GENERATOR_CONFIG
  // 确定性种子：结合村代码和全局种子
  const rng = createSeededRandom(hashString(village.code) + globalSeed)

  // 计算总承保面积
  const totalInsuredAreaMu = parcels.reduce((sum, p) => sum + p.areaMu, 0)
  if (totalInsuredAreaMu <= 0) {
    return { villageCode: village.code, parcels: parcels.map(p => ({
      parcelId: p.parcelId, villageCode: p.villageCode, areaMu: p.areaMu,
      sumInsured: p.sumInsured, insuredPartyId: p.insuredPartyId,
      damageAreaMu: 0, damageRate: 0,
    })), centerPoints: [] }
  }

  // 目标受灾面积比例（检查是否有覆盖值）
  const override = VILLAGE_DAMAGE_OVERRIDE[village.code]
  const targetDamageRatio = override
    ? override.targetDamageRatio
    : randomFloat(rng, cfg.DAMAGE_RATIO_MIN, cfg.DAMAGE_RATIO_MAX)
  const targetDamagedAreaMu = totalInsuredAreaMu * targetDamageRatio

  // 村域 GeoJSON（用于点在面内判断）
  const villageGeo = villageToGeoJSONPolygon(village)

  // 生成灾害中心点（override 村使用更多中心点以覆盖更大区域）
  const centerCount = override
    ? randomInt(rng, cfg.CENTER_COUNT_MAX, cfg.CENTER_COUNT_MAX + 2)  // 4-6 for override
    : randomInt(rng, cfg.CENTER_COUNT_MIN, cfg.CENTER_COUNT_MAX)     // 2-4 for normal
  const centerPoints: [number, number][] = []
  for (let i = 0; i < centerCount; i++) {
    const pt = randomPointInVillage(village, villageGeo, rng)
    if (pt) centerPoints.push(pt)
  }
  if (centerPoints.length === 0) {
    // 退化：使用质心
    centerPoints.push([village.centroid.lon, village.centroid.lat])
  }

  // 为每个地块计算距最近中心点的距离，确定受损率
  const parcelResults: ParcelDamageOutput[] = []
  let accumulatedDamagedArea = 0

  // 先按距离排序，优先受灾离中心近的地块
  const parcelsWithDistance = parcels.map(p => {
    let minDist = Infinity
    for (const center of centerPoints) {
      const d = turfDistance(turfPoint(p.centroid), turfPoint(center), { units: 'meters' })
      if (d < minDist) minDist = d
    }
    return { parcel: p, minDist }
  })
  parcelsWithDistance.sort((a, b) => a.minDist - b.minDist)

  for (const { parcel, minDist } of parcelsWithDistance) {
    // Override 村：使用扩大缓冲区（800m），保留空间边界（缓冲外不受灾）
    // 普通村：使用标准缓冲区（400m）+ 目标截止
    const bufferRadiusMax = override
      ? DAMAGE_GENERATOR_CONFIG.BUFFER_RADIUS_MAX_M * 2  // 800m for override
      : DAMAGE_GENERATOR_CONFIG.BUFFER_RADIUS_MAX_M      // 400m for normal

    const bracket = override
      ? extendedDistanceBracket(minDist, bufferRadiusMax)
      : distanceBracket(minDist)

    if (bracket === null) {
      // 超出缓冲区，不受灾
      parcelResults.push({
        parcelId: parcel.parcelId,
        villageCode: parcel.villageCode,
        areaMu: parcel.areaMu,
        sumInsured: parcel.sumInsured,
        insuredPartyId: parcel.insuredPartyId,
        damageAreaMu: 0,
        damageRate: 0,
      })
      continue
    }

    // 普通村：如果已经达到了目标受灾面积，剩余地块不受灾
    if (!override && accumulatedDamagedArea >= targetDamagedAreaMu) {
      parcelResults.push({
        parcelId: parcel.parcelId,
        villageCode: parcel.villageCode,
        areaMu: parcel.areaMu,
        sumInsured: parcel.sumInsured,
        insuredPartyId: parcel.insuredPartyId,
        damageAreaMu: 0,
        damageRate: 0,
      })
      continue
    }

    // 在该档位内随机生成受损率
    const rate = randomFloat(rng, bracket.min, bracket.max)
    const actualDamageAreaMu = Math.round(parcel.areaMu * rate / 100 * 100) / 100
    accumulatedDamagedArea += actualDamageAreaMu

    parcelResults.push({
      parcelId: parcel.parcelId,
      villageCode: parcel.villageCode,
      areaMu: parcel.areaMu,
      sumInsured: parcel.sumInsured,
      insuredPartyId: parcel.insuredPartyId,
      damageAreaMu: actualDamageAreaMu,
      damageRate: Math.round(rate * 100) / 100,
    })
  }

  // 如果该村有覆盖值，对 damageAreaMu 做等比缩放，使村级受灾率精确逼近目标值
  if (override) {
    const actualDamagedAreaMu = parcelResults.reduce((sum, p) => sum + p.damageAreaMu, 0)
    const actualRatio = actualDamagedAreaMu / totalInsuredAreaMu
    if (actualRatio > 0.001) {
      const scaleFactor = targetDamageRatio / actualRatio
      for (const p of parcelResults) {
        if (p.damageAreaMu > 0) {
          // 直接缩放 damageAreaMu（不超过 areaMu），damageRate 作为派生值
          const scaledDamage = Math.round(p.damageAreaMu * scaleFactor * 100) / 100
          p.damageAreaMu = Math.min(p.areaMu, scaledDamage)
          p.damageRate = Math.round((p.damageAreaMu / p.areaMu) * 10000) / 100
        }
      }
    }
  }

  return {
    villageCode: village.code,
    parcels: parcelResults,
    centerPoints,
  }
}

/**
 * 为所有村生成连片受灾数据。
 *
 * @param villages 所有村边界数据
 * @param parcelsByVillage 按村代码分组的地块数据
 * @param globalSeed 全局种子
 */
export function generateAllVillagesDamage(
  villages: VillageBoundary[],
  parcelsByVillage: Map<string, ParcelInput[]>,
  globalSeed: number = 20260821,
): Map<string, VillageDamageResult> {
  const results = new Map<string, VillageDamageResult>()
  for (const village of villages) {
    const parcels = parcelsByVillage.get(village.code) ?? []
    if (parcels.length === 0) continue
    const result = generateVillageDamage(village, parcels, globalSeed)
    results.set(village.code, result)
  }
  return results
}
