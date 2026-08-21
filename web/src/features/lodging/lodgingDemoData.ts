/**
 * 水稻倒伏评估 —— 演示模式数据桥接（v2.0）
 *
 * 职责：
 * - 从保单地块数据 + 地块 GeoJSON + 村边界数据 生成连片受灾演示数据
 * - 调用 lodgingDamageGenerator 的空间连片算法
 * - 输出 lodgingCalc.ParcelDamage[] 供汇总层消费
 *
 * v2.0 变更（相对 v1.3）：
 * - 移除 DEMO_DAMAGE_MAP 硬编码
 * - 移除 signalsForDamageRate / getDemoDamageForParcel / getVillageParcelDamageRate
 * - 改为调用 lodgingDamageGenerator 连片生成
 */

import type { FeatureCollection } from 'geojson'
import { fetchJSON } from '../../api/data'
import type { VillageBoundary } from '../village-risk/villageRiskData'
import type { ParcelInput, VillageDamageResult } from './lodgingDamageGenerator'
import { generateVillageDamage } from './lodgingDamageGenerator'
import type { ParcelDamage } from './lodgingCalc'
import centroid from '@turf/center'

/** 全局随机种子（可配置，用于演示数据一致性） */
export const DEMO_GLOBAL_SEED = 20260821

/** 保单地块原始数据（从 fixture 提取） */
export interface ParcelCoverageInput {
  parcelId: string
  areaMu: number
  sumInsured: number
  insuredPartyId: string
}

/**
 * 从地块 GeoJSON 计算每个地块的质心坐标。
 * 返回 Map<parcelId, [lon, lat]>。
 */
function computeParcelCentroids(
  parcelFc: FeatureCollection,
): Map<string, [number, number]> {
  const centroids = new Map<string, [number, number]>()
  for (const feature of parcelFc.features) {
    const id = String(feature.properties?.id ?? feature.properties?.parcelId ?? '')
    if (!id || !feature.geometry) continue
    try {
      const c = centroid(feature)
      centroids.set(id, c.geometry.coordinates as [number, number])
    } catch {
      // 退化：使用 bbox 中心（如果没有 bbox，跳过）
      // 实际中大多数 polygon feature 都能正常计算 centroid
    }
  }
  return centroids
}

/**
 * 为单个村生成演示受灾数据。
 */
function generateDemoForVillage(
  village: VillageBoundary,
  coverages: ParcelCoverageInput[],
  parcelCentroids: Map<string, [number, number]>,
  seed: number,
): VillageDamageResult {
  // 构造 ParcelInput（只保留有质心的地块）
  const parcelInputs: ParcelInput[] = []
  for (const cov of coverages) {
    const centroid = parcelCentroids.get(cov.parcelId)
    if (!centroid) continue
    parcelInputs.push({
      parcelId: cov.parcelId,
      villageCode: village.code,
      areaMu: cov.areaMu,
      sumInsured: cov.sumInsured,
      insuredPartyId: cov.insuredPartyId,
      centroid,
    })
  }

  return generateVillageDamage(village, parcelInputs, seed)
}

/**
 * 加载单个村的地块 GeoJSON（用于计算质心）。
 */
async function loadParcelGeoJSON(villageCode: string): Promise<FeatureCollection | null> {
  try {
    return await fetchJSON<FeatureCollection>(`/data/parcels/${villageCode}.geojson`)
  } catch {
    return null
  }
}

/**
 * 为所有村生成演示受灾数据。
 *
 * @param villages 村边界数据（来自 loadInsuredVillages）
 * @param coveragesByVillage 按村代码分组的保单地块数据
 * @returns 所有地块的受损数据（ParcelDamage[]）
 */
export async function generateDemoDamageData(
  villages: VillageBoundary[],
  coveragesByVillage: Map<string, ParcelCoverageInput[]>,
  seed: number = DEMO_GLOBAL_SEED,
): Promise<ParcelDamage[]> {
  const results: ParcelDamage[] = []

  // 并行加载所有村的地块 GeoJSON
  const villageCodes = [...coveragesByVillage.keys()]
  const geojsonResults = await Promise.all(
    villageCodes.map(async (code) => {
      const fc = await loadParcelGeoJSON(code)
      return { code, fc }
    })
  )

  // 计算质心
  const centroidsByVillage = new Map<string, Map<string, [number, number]>>()
  for (const { code, fc } of geojsonResults) {
    if (fc) {
      centroidsByVillage.set(code, computeParcelCentroids(fc))
    }
  }

  // 按村生成
  const villageMap = new Map(villages.map(v => [v.code, v]))
  for (const [villageCode, coverages] of coveragesByVillage) {
    const village = villageMap.get(villageCode)
    if (!village) continue

    const centroids = centroidsByVillage.get(villageCode)
    if (!centroids || centroids.size === 0) continue

    const damageResult = generateDemoForVillage(village, coverages, centroids, seed)
    for (const p of damageResult.parcels) {
      results.push({
        parcelId: p.parcelId,
        villageCode: p.villageCode,
        areaMu: p.areaMu,
        sumInsured: p.sumInsured,
        damageAreaMu: p.damageAreaMu,
        damageRate: p.damageRate,
        insuredPartyId: p.insuredPartyId,
      })
    }
  }

  return results
}
