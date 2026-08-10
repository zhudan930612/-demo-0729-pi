import type { PrecipGridPoint, PrecipitationSnapshot } from '../precipitation/precipitationTypes'
import { PRECIP_DAY_KEYS } from '../precipitation/precipitationTypes'
import type { TyphoonDetail, ObservationNode } from '../typhoon/typhoonTypes'
import type { NationalWeatherAlarm } from '../national-alarms/nationalAlarmTypes'
import {
  alarmSignal,
  combineRisk,
  dailyStatsForVillage,
  hasConsecutiveRain,
  precipSignal,
  typhoonSignal,
  villageDailyMeans,
  villagePeak,
  type AlarmLike,
  type RiskLevel,
  type RiskPathPoint,
  type VillagePeak,
  type WindRadiiLike,
} from './villageRisk'

/**
 * 参保村灾害风险联动 —— 数据层（需求 §6）
 * 参保村清单/村界加载、村界覆盖网格点、台风/预警数据提取、村级风险装配。
 */

// ---------- 13 参保村（章镇 8 + 三界 5） ----------
export const INSURED_VILLAGE_CODES: readonly string[] = [
  // 上虞区 · 章镇镇
  '330604102014', // 龙江村
  '330604102011', // 新南村
  '330604102015', // 大钱村
  '330604102016', // 清潭村
  '330604102017', // 新魏家庄村
  '330604102018', // 新三联村
  '330604102020', // 新魏村
  '330604102033', // 湾头村
  // 嵊州市 · 三界镇
  '330683104307', // 临虞村
  '330683104306', // 北街村
  '330683104224', // 白沙村
  '330683104308', // 车骑山村
  '330683104309', // 盛岙村
]

/** 村码前缀 → 乡镇 villages 文件（村码前缀 ≠ 乡镇码，须从 villages 文件匹配，见多村保单计划 §2.4） */
export const VILLAGE_TOWNSHIP_FILES: Readonly<Record<string, string>> = {
  '330604102': '/data/villages/330604104000.geojson',
  '330683104': '/data/villages/330683104000.geojson',
}

/** 村 → 区县（村码前 6 位；章镇村→330604 上虞区，三界村→330683 嵊州市） */
export function countyCodeOf(villageCode: string): string {
  return villageCode.slice(0, 6)
}

export function townshipFileOf(villageCode: string): string | null {
  for (const prefix of Object.keys(VILLAGE_TOWNSHIP_FILES)) {
    if (villageCode.startsWith(prefix)) return VILLAGE_TOWNSHIP_FILES[prefix]
  }
  return null
}

// ---------- 村界 ----------
export interface VillageBoundary {
  code: string
  name: string
  /** 多 polygon，每项为单个 Polygon 的 rings：第 0 环为外环，其余为洞（[lon, lat]） */
  polygons: Array<Array<Array<[number, number]>>>
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  /** bbox 中心（台风距离/网格单元关联用） */
  centroid: { lat: number; lon: number }
  countyCode: string
}

function collectPolygons(geometry: { type: string; coordinates: unknown }): Array<Array<Array<[number, number]>>> {
  const polygons: Array<Array<Array<[number, number]>>> = []
  const pushPoly = (poly: unknown) => {
    if (!Array.isArray(poly)) return
    const rings: Array<Array<[number, number]>> = []
    for (const ring of poly as unknown[][]) {
      if (!Array.isArray(ring)) continue
      const pts: Array<[number, number]> = []
      for (const p of ring) {
        if (!Array.isArray(p) || p.length < 2) continue
        const lon = Number(p[0])
        const lat = Number(p[1])
        if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push([lon, lat])
      }
      if (pts.length >= 3) rings.push(pts)
    }
    if (rings.length > 0) polygons.push(rings)
  }
  if (geometry.type === 'Polygon') pushPoly(geometry.coordinates)
  else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates as unknown[][]) pushPoly(poly)
  }
  return polygons
}

function bboxOf(polygons: Array<Array<Array<[number, number]>>>): VillageBoundary['bbox'] {
  let latMin = Infinity
  let latMax = -Infinity
  let lonMin = Infinity
  let lonMax = -Infinity
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lon, lat] of ring) {
        if (lat < latMin) latMin = lat
        if (lat > latMax) latMax = lat
        if (lon < lonMin) lonMin = lon
        if (lon > lonMax) lonMax = lon
      }
    }
  }
  return { latMin, latMax, lonMin, lonMax }
}

/** 加载 13 参保村村界（两次乡镇文件请求；失败降级为空数组）。 */
export async function loadInsuredVillages(fetchImpl: typeof fetch = globalThis.fetch): Promise<VillageBoundary[]> {
  const results: VillageBoundary[] = []
  const files = new Set(INSURED_VILLAGE_CODES.map((code) => townshipFileOf(code)).filter((f): f is string => Boolean(f)))
  for (const file of files) {
    try {
      const response = await fetchImpl(file)
      if (!response.ok) continue
      const gj = (await response.json()) as { features?: Array<{ properties?: { code?: unknown; name?: unknown }; geometry?: { type: string; coordinates: unknown } }> }
      for (const feature of gj.features ?? []) {
        const code = String(feature.properties?.code ?? '')
        if (!INSURED_VILLAGE_CODES.includes(code)) continue
        const geometry = feature.geometry
        if (!geometry) continue
        const polygons = collectPolygons(geometry)
        if (polygons.length === 0) continue
        const bbox = bboxOf(polygons)
        results.push({
          code,
          name: String(feature.properties?.name ?? code),
          polygons,
          bbox,
          centroid: { lat: (bbox.latMin + bbox.latMax) / 2, lon: (bbox.lonMin + bbox.lonMax) / 2 },
          countyCode: countyCodeOf(code),
        })
      }
    } catch {
      // 单文件失败降级，不阻断其他村
    }
  }
  return results
}

// ---------- 点在多边形内（ray casting，支持洞） ----------
export function pointInRing(lat: number, lon: number, ring: ReadonlyArray<[number, number]>): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = ((yi > lat) !== (yj > lat))
      && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** 点在村内：任一 polygon 的外环包含且不被洞包含。 */
export function pointInVillage(lat: number, lon: number, village: VillageBoundary): boolean {
  for (const polygon of village.polygons) {
    const outer = polygon[0]
    if (!outer || !pointInRing(lat, lon, outer)) continue
    let inHole = false
    for (let i = 1; i < polygon.length; i++) {
      if (pointInRing(lat, lon, polygon[i])) { inHole = true; break }
    }
    if (!inHole) return true
  }
  return false
}

export const GRID_HALF_SPACING = 0.125 // 0.25° 网格半间距（单元关联半径）

/** 村界覆盖网格点：网格点落在村内，或其 0.125° 单元与村相交（单元四角在村内 / 村 bbox 中心在单元内）。
 *  保证每村至少关联 1 个网格点，避免小村落在网格缝隙被判"无覆盖"（需求 §3.3）。 */
export function coveredGridPoints(village: VillageBoundary, grid: readonly PrecipGridPoint[]): PrecipGridPoint[] {
  const { latMin, latMax, lonMin, lonMax } = village.bbox
  const candidates = grid.filter((p) => p.lat >= latMin - GRID_HALF_SPACING && p.lat <= latMax + GRID_HALF_SPACING && p.lon >= lonMin - GRID_HALF_SPACING && p.lon <= lonMax + GRID_HALF_SPACING)
  return candidates.filter((p) => {
    if (pointInVillage(p.lat, p.lon, village)) return true
    // 单元四角（网格点半间距方形）任一在村内
    const corners: Array<[number, number]> = [
      [p.lat - GRID_HALF_SPACING, p.lon - GRID_HALF_SPACING],
      [p.lat - GRID_HALF_SPACING, p.lon + GRID_HALF_SPACING],
      [p.lat + GRID_HALF_SPACING, p.lon - GRID_HALF_SPACING],
      [p.lat + GRID_HALF_SPACING, p.lon + GRID_HALF_SPACING],
    ]
    if (corners.some(([clat, clon]) => pointInVillage(clat, clon, village))) return true
    // 村 bbox 中心落在单元内
    return Math.abs(village.centroid.lat - p.lat) <= GRID_HALF_SPACING && Math.abs(village.centroid.lon - p.lon) <= GRID_HALF_SPACING
  })
}

// ---------- 台风/预警数据提取 ----------
export function observationRiskPath(observation: ObservationNode | null): RiskPathPoint[] {
  if (!observation) return []
  const points: RiskPathPoint[] = [{ lat: observation.lat, lon: observation.lon, windSpeedMs: observation.windSpeedMs, intensityText: observation.intensityText }]
  for (const node of observation.forecastSnapshot?.nodes ?? []) {
    points.push({ lat: node.lat, lon: node.lon, windSpeedMs: node.windSpeedMs, intensityText: node.intensityText })
  }
  return points
}

export function observationWindRadii(observation: ObservationNode | null): WindRadiiLike[] | null {
  const radii = observation?.windRadii
  return Array.isArray(radii) && radii.length > 0 ? (radii as WindRadiiLike[]) : null
}

/** 从台风 store 中提取全部在案实时台风的最近观测 + 预报路径（覆盖时长以上游实测为准）。 */
export function latestTyphoonRiskPaths(details: readonly TyphoonDetail[]): Array<{ path: RiskPathPoint[]; windRadii: WindRadiiLike[] | null; maxForecastHour: number | null }> {
  const result: Array<{ path: RiskPathPoint[]; windRadii: WindRadiiLike[] | null; maxForecastHour: number | null }> = []
  for (const detail of details) {
    if (detail.status !== 'start') continue
    const observation = detail.latestObservation
    if (!observation) continue
    result.push({
      path: observationRiskPath(observation),
      windRadii: observationWindRadii(observation),
      maxForecastHour: observation.forecastSnapshot?.maxForecastHour ?? null,
    })
  }
  return result
}

export function alarmItems(snapshot: { items: readonly NationalWeatherAlarm[] } | null): AlarmLike[] {
  return (snapshot?.items ?? []).map((alarm) => ({
    adminCode: alarm.adminCode,
    eventType: alarm.eventType,
    severity: alarm.severity,
  }))
}

// ---------- 村级风险装配 ----------
export interface VillageRiskInput {
  village: VillageBoundary
  snapshot: PrecipitationSnapshot | null
  typhoons: Array<{ path: RiskPathPoint[]; windRadii: WindRadiiLike[] | null }>
  alarms: readonly AlarmLike[]
}

export interface VillageRiskResult {
  level: RiskLevel
  peak: VillagePeak
  consecutive: boolean
  precipSignal: RiskLevel
  typhoonSignal: RiskLevel
  typhoonPathDistanceKm: number | null
  typhoonWindCovered: boolean
  alarmSignal: 0 | 1 | 3
  matchedEvent: string | null
}

/** 村级风险装配：三源信号 → 综合等级（需求 §3.2）。降水快照不可用 → 降水信号 0。 */
export function computeVillageRisk(input: VillageRiskInput): VillageRiskResult {
  const village = input.village
  const snapshot = input.snapshot
  let peak: VillagePeak = { level: 0, mm: 0, dayIndex: 0 }
  let consecutive = false
  let precipLevel: RiskLevel = 0
  if (snapshot) {
    const covered = coveredGridPoints(village, snapshot.grid)
    const dailyStats = dailyStatsForVillage(covered)
    peak = villagePeak(dailyStats)
    consecutive = hasConsecutiveRain(villageDailyMeans(dailyStats))
    precipLevel = precipSignal(peak.level, consecutive)
  }
  let typhoonLevel: RiskLevel = 0
  let typhoonPathDistanceKm: number | null = null
  let typhoonWindCovered = false
  for (const entry of input.typhoons) {
    const result = typhoonSignal(village.centroid, entry.path, entry.windRadii)
    if (result.signal > typhoonLevel) typhoonLevel = result.signal
    if (result.pathDistanceKm !== null) {
      typhoonPathDistanceKm = typhoonPathDistanceKm === null ? result.pathDistanceKm : Math.min(typhoonPathDistanceKm, result.pathDistanceKm)
    }
    if (result.windCovered) typhoonWindCovered = true
  }
  const alarm = alarmSignal(input.alarms, village.countyCode)
  const level = combineRisk(precipLevel, typhoonLevel, alarm.signal as 0 | 1 | 3)
  return {
    level,
    peak,
    consecutive,
    precipSignal: precipLevel,
    typhoonSignal: typhoonLevel,
    typhoonPathDistanceKm,
    typhoonWindCovered,
    alarmSignal: alarm.signal as 0 | 1 | 3,
    matchedEvent: alarm.matchedEvent,
  }
}

export { PRECIP_DAY_KEYS }
