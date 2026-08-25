import type { GrowthLevel, NdviRaster } from './agriMonitoringTypes'
import { GROWTH_LEVELS, growthLevelOf } from './agriMonitoringTypes'

/** GeoJSON Polygon / MultiPolygon 的点内判定（射线法）。 */
function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    const intersect = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
function pointInPolygon(lon: number, lat: number, poly: number[][][]): boolean {
  if (!pointInRing(lon, lat, poly[0]!)) return false
  for (let h = 1; h < poly.length; h++) if (pointInRing(lon, lat, poly[h]!)) return false
  return true
}
export function pointInGeometry(lon: number, lat: number, geom: { type: string; coordinates: unknown }): boolean {
  if (geom.type === 'Polygon') return pointInPolygon(lon, lat, geom.coordinates as number[][][])
  if (geom.type === 'MultiPolygon') {
    for (const p of geom.coordinates as number[][][][]) if (pointInPolygon(lon, lat, p)) return true
  }
  return false
}

export interface RegionAggregate {
  levels: Record<GrowthLevel, number>
  farmArea: number // 亩（NDVI≥0.4 格数 × 每格亩）
}

/** 村级 on-demand：用已载栅格按几何聚合 5级占比 + 农田面积。 */
export function aggregateRegion(raster: NdviRaster, dateIndex: number, geom: { type: string; coordinates: unknown }): RegionAggregate | null {
  const { originLon, originLat, stepLon, stepLat, cols, rows, layers } = raster
  // 收集所有环（每个环 = 一组 [lon,lat]），不 over-flatten
  const rings: number[][][] = []
  if (geom.type === 'Polygon') rings.push(...(geom.coordinates as number[][][]))
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates as number[][][][]) rings.push(...poly)
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat
    }
  }
  const ci0 = Math.max(0, Math.ceil((minLon - originLon) / stepLon))
  const ci1 = Math.min(cols - 1, Math.floor((maxLon - originLon) / stepLon))
  const ri0 = Math.max(0, Math.ceil((minLat - originLat) / stepLat))
  const ri1 = Math.min(rows - 1, Math.floor((maxLat - originLat) / stepLat))
  if (ci1 < ci0 || ri1 < ri0) return null
  const layer = layers[dateIndex]!
  const counts: Record<GrowthLevel, number> = { veryPoor: 0, poor: 0, normal: 0, good: 0, excellent: 0 }
  let farmCells = 0
  for (let ri = ri0; ri <= ri1; ri++) {
    const lat = originLat + (ri + 0.5) * stepLat
    for (let ci = ci0; ci <= ci1; ci++) {
      const lon = originLon + (ci + 0.5) * stepLon
      if (!pointInGeometry(lon, lat, geom)) continue
      const v = layer[ri * cols + ci] ?? 0
      if (!v || v <= 0) continue
      const lv = growthLevelOf(v / 100)
      counts[lv] = counts[lv]! + 1
      if (v >= 40) farmCells++
    }
  }
  const total = counts.veryPoor + counts.poor + counts.normal + counts.good + counts.excellent
  if (total === 0) return null
  const levels = Object.fromEntries(GROWTH_LEVELS.map((l) => [l, counts[l] / total])) as Record<GrowthLevel, number>
  const cellAreaMu = stepLon * 111000 * Math.cos(((originLat + 0.5) * Math.PI) / 180) * stepLat * 111000 / 666.667
  return { levels, farmArea: Math.round(farmCells * cellAreaMu) }
}

/** 按村栅格子区域分组采样：每保单取村内一组栅格cell的真实5级分布（自然、不重复）。 */
export function aggregateRegionGrouped(raster: NdviRaster, dateIndex: number, geom: { type: string; coordinates: unknown }, groups: number): Array<{ levels: Record<GrowthLevel, number>; farmArea: number }> | null {
  const { originLon, originLat, stepLon, stepLat, cols, rows, layers } = raster
  const rings: number[][][] = []
  if (geom.type === 'Polygon') rings.push(...(geom.coordinates as number[][][]))
  else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates as number[][][][]) rings.push(...poly)
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const ring of rings) for (const [lon, lat] of ring) { if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat }
  const ci0 = Math.max(0, Math.ceil((minLon - originLon) / stepLon)); const ci1 = Math.min(cols - 1, Math.floor((maxLon - originLon) / stepLon))
  const ri0 = Math.max(0, Math.ceil((minLat - originLat) / stepLat)); const ri1 = Math.min(rows - 1, Math.floor((maxLat - originLat) / stepLat))
  if (ci1 < ci0 || ri1 < ri0) return null
  const layer = layers[dateIndex]!
  const perGroup = Array.from({ length: groups }, () => ({ counts: { veryPoor: 0, poor: 0, normal: 0, good: 0, excellent: 0 } as Record<GrowthLevel, number>, farm: 0 }))
  let total = 0
  for (let ri = ri0; ri <= ri1; ri++) {
    const lat = originLat + (ri + 0.5) * stepLat
    for (let ci = ci0; ci <= ci1; ci++) {
      const lon = originLon + (ci + 0.5) * stepLon
      if (!pointInGeometry(lon, lat, geom)) continue
      const v = layer[ri * cols + ci] ?? 0
      if (!v || v <= 0) continue
      const g = perGroup[(ri * cols + ci) % groups]!
      const lv = growthLevelOf(v / 100)
      g.counts[lv] = g.counts[lv]! + 1
      if (v >= 40) g.farm++
      total++
    }
  }
  if (total === 0) return null
  const cellAreaMu = stepLon * 111000 * Math.cos(((originLat + 0.5) * Math.PI) / 180) * stepLat * 111000 / 666.667
  // 空组（村较小）回落为整体分布
  const overall = perGroup.reduce((acc, g) => { for (const lv of GROWTH_LEVELS) acc.counts[lv] += g.counts[lv]!; acc.farm += g.farm; return acc }, { counts: { veryPoor: 0, poor: 0, normal: 0, good: 0, excellent: 0 } as Record<GrowthLevel, number>, farm: 0 })
  return perGroup.map((g) => {
    const src = (g.counts.veryPoor + g.counts.poor + g.counts.normal + g.counts.good + g.counts.excellent) > 0 ? g : overall
    const sum = src.counts.veryPoor + src.counts.poor + src.counts.normal + src.counts.good + src.counts.excellent
    const levels = Object.fromEntries(GROWTH_LEVELS.map((l) => [l, sum > 0 ? src.counts[l] / sum : 0])) as Record<GrowthLevel, number>
    return { levels, farmArea: Math.round(src.farm * cellAreaMu) }
  })
}

/** 村承保面积 A1：村之和=镇。非参保村 = 镇承保面积 × (村farmArea / 全镇farmArea)。 */
export function splitTownshipArea(
  townshipArea: number,
  farmAreas: Array<{ code: string; farmArea: number }>,
): Array<{ code: string; area: number }> {
  const total = farmAreas.reduce((s, f) => s + f.farmArea, 0)
  return farmAreas.map((f) => ({ code: f.code, area: total > 0 ? Math.round((townshipArea * f.farmArea) / total) : 0 }))
}
