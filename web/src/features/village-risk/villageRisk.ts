import type { PrecipGridPoint, PrecipDayKey } from '../precipitation/precipitationTypes'
import { PRECIP_DAY_KEYS, dayValue } from '../precipitation/precipitationTypes'

/**
 * 参保村灾害风险联动 —— 纯判定逻辑（需求 §3）
 * 三源信号（降水/台风/预警）+ 综合算法 + 村级降水口径，全部无副作用，单测锁定。
 */

// ---------- 类型 ----------
export type RiskLevel = 0 | 1 | 2 | 3
export const RISK_LEVEL_TEXT: Record<RiskLevel, string> = { 0: '无风险', 1: '低风险', 2: '中风险', 3: '高风险' }
export const RISK_LEVEL_SHORT: Record<RiskLevel, string> = { 0: '无', 1: '低', 2: '中', 3: '高' }

// ---------- 降水信号 ----------
/** 24h 累计降水峰值分档：0~24.9→0；25~49.9→1；50~99.9→2；≥100→3（需求 §3.1b） */
export function precipPeakLevel(mm: number): RiskLevel {
  if (!Number.isFinite(mm) || mm < 25) return 0
  if (mm < 50) return 1
  if (mm < 100) return 2
  return 3
}

export const CONSECUTIVE_RAIN_WINDOW = 3
export const CONSECUTIVE_RAIN_SUM_MM = 50

/** 连续降雨信号：7 天窗口内存在连续 3 日累计 ≥50mm（连阴雨/渍涝，需求拷打后新增）。
 *  输入为该村每日均值序列（村级代表口径）。 */
export function hasConsecutiveRain(dailyMeans: readonly number[]): boolean {
  const values = dailyMeans.map((v) => (Number.isFinite(v) ? v : 0))
  for (let i = 0; i + CONSECUTIVE_RAIN_WINDOW <= values.length; i++) {
    let sum = 0
    for (let j = 0; j < CONSECUTIVE_RAIN_WINDOW; j++) sum += values[i + j]
    if (sum >= CONSECUTIVE_RAIN_SUM_MM) return true
  }
  return false
}

/** 降水信号：峰值信号 + 连续降雨信号（+1 封顶 3，需求 §3.1） */
export function precipSignal(peakLevel: RiskLevel, consecutive: boolean): RiskLevel {
  if (!consecutive) return peakLevel
  return Math.min(3, peakLevel + 1) as RiskLevel
}

// ---------- 台风信号 ----------
export const TYPOON_PATH_DISTANCE_KM = 50
export const STRONG_TROPICAL_STORM_WIND_MS = 24.5 // 强热带风暴级起始风速（10 级）
const STORM_LEVEL_TEXTS = ['强热带风暴', '台风', '强台风', '超强台风']

export interface RiskPathPoint {
  lat: number
  lon: number
  windSpeedMs?: number
  intensityText?: string
}

export interface WindRadiiLike {
  grade?: string
  neRadiusKm: number
  seRadiusKm: number
  swRadiusKm: number
  nwRadiusKm: number
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** 点到线段最短距离（km）：预报点间隔大，点-点距离会漏判路径从中穿过（需求拷打 C2）。
 *  采用参考纬度的平面近似（50km 量级足够精确）。 */
export function pointSegmentDistanceKm(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number,
): number {
  const K = 111.32
  const cosRef = Math.cos(((pLat + aLat) / 2) * Math.PI / 180)
  const px = pLon * K * cosRef
  const py = pLat * K
  const ax = aLon * K * cosRef
  const ay = aLat * K
  const bx = bLon * K * cosRef
  const by = bLat * K
  const abx = bx - ax
  const aby = by - ay
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * abx + (py - ay) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby))
}

/** 从台风中心到目标点的初始方位角（度，0~360） */
function bearingDeg(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const dLon = ((toLon - fromLon) * Math.PI) / 180
  const y = Math.sin(dLon) * Math.cos((toLat * Math.PI) / 180)
  const x = Math.cos((fromLat * Math.PI) / 180) * Math.sin((toLat * Math.PI) / 180)
    - Math.sin((fromLat * Math.PI) / 180) * Math.cos((toLat * Math.PI) / 180) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/** 实时风圈覆盖判定：按方位角取对应象限半径（NE 0-90 / SE 90-180 / SW 180-270 / NW 270-360），
 *  各等级半径取最大；距离 ≤ 半径即覆盖。预报点无风圈字段，风圈只对实时观测判定（需求拷打 A2）。 */
export function windCircleCovers(
  villageLat: number, villageLon: number,
  centerLat: number, centerLon: number,
  radii: readonly WindRadiiLike[] | null | undefined,
): boolean {
  if (!Array.isArray(radii) || radii.length === 0) return false
  const distance = haversineKm(villageLat, villageLon, centerLat, centerLon)
  const bearing = bearingDeg(centerLat, centerLon, villageLat, villageLon)
  let maxRadius = 0
  for (const r of radii) {
    const quad = bearing < 90 ? r.neRadiusKm : bearing < 180 ? r.seRadiusKm : bearing < 270 ? r.swRadiusKm : r.nwRadiusKm
    if (Number.isFinite(quad)) maxRadius = Math.max(maxRadius, quad)
  }
  return maxRadius > 0 && distance <= maxRadius
}

function isStormLevel(point: RiskPathPoint): boolean {
  if (Number.isFinite(point.windSpeedMs) && (point.windSpeedMs ?? 0) >= STRONG_TROPICAL_STORM_WIND_MS) return true
  const text = point.intensityText ?? ''
  return STORM_LEVEL_TEXTS.some((name) => text.includes(name))
}

export interface TyphoonSignalResult {
  signal: RiskLevel
  pathDistanceKm: number | null
  windCovered: boolean
  stormNearby: boolean
}

/** 台风信号（需求 §3.1）：路径点-线段距离 ≤50km → 2；实时风圈覆盖 → 2；强热带风暴及以上路径临近 → 3。
 *  path 首点通常为实时观测，后续为预报点（覆盖时长以上游实测为准）。 */
export function typhoonSignal(
  village: { lat: number; lon: number },
  path: readonly RiskPathPoint[],
  windRadii: readonly WindRadiiLike[] | null | undefined,
): TyphoonSignalResult {
  const pts = (path ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
  let pathDistanceKm: number | null = null
  let stormNearby = false
  if (pts.length >= 1) {
    for (let i = 0; i < pts.length; i++) {
      const d = haversineKm(village.lat, village.lon, pts[i].lat, pts[i].lon)
      pathDistanceKm = pathDistanceKm === null ? d : Math.min(pathDistanceKm, d)
      if (d <= TYPOON_PATH_DISTANCE_KM && isStormLevel(pts[i])) stormNearby = true
    }
    if (pts.length >= 2) {
      for (let i = 0; i < pts.length - 1; i++) {
        const d = pointSegmentDistanceKm(village.lat, village.lon, pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon)
        pathDistanceKm = Math.min(pathDistanceKm, d)
      }
    }
  }
  const windCovered = pts.length >= 1
    && windCircleCovers(village.lat, village.lon, pts[0].lat, pts[0].lon, windRadii)
  let signal: RiskLevel = 0
  if (pathDistanceKm !== null && pathDistanceKm <= TYPOON_PATH_DISTANCE_KM) signal = 2
  if (windCovered) signal = Math.max(signal, 2) as RiskLevel
  if (stormNearby) signal = 3
  return { signal, pathDistanceKm, windCovered, stormNearby }
}

// ---------- 预警信号 ----------
/** 与水稻防灾相关的预警事件类型（NMC 标题解析出的 eventType 全集见 server national-alarm-service EVENT_TYPES；
 *  取暴雨/台风/大风/雷电/冰雹 = 强对流降雨类，高温/寒潮/干旱等不参与提级）。 */
export const RISK_RELEVANT_ALARM_EVENTS = ['暴雨', '台风', '大风', '雷电', '冰雹']

export interface AlarmLike {
  adminCode: string | null
  eventType: string | null
  severity: 'red' | 'orange' | 'yellow' | 'blue' | 'unknown' | string
}

export interface AlarmSignalResult {
  /** 0=无；1=有相关预警（提级信号）；3=红色预警直接高 */
  signal: RiskLevel
  relevantMatched: boolean
  redMatched: boolean
  matchedEvent: string | null
}

/** 预警信号（需求 §3.1）：按区县（村码前 6 位）匹配当前生效预警；暴雨/台风/强对流类 → +1；
 *  红色预警直接 3。无预警不降级（0）。 */
export function alarmSignal(alarms: readonly AlarmLike[] | null | undefined, countyCode: string): AlarmSignalResult {
  const relevant = (alarms ?? []).filter((a) => a.adminCode === countyCode)
  const matched = relevant.find((a) => a.eventType !== null && RISK_RELEVANT_ALARM_EVENTS.includes(a.eventType))
  const redMatched = relevant.some((a) => a.severity === 'red' && a.eventType !== null && RISK_RELEVANT_ALARM_EVENTS.includes(a.eventType))
  const signal: RiskLevel = redMatched ? 3 : matched ? 1 : 0
  return { signal, relevantMatched: Boolean(matched), redMatched, matchedEvent: matched?.eventType ?? null }
}

// ---------- 综合算法（需求 §3.2，单一算法） ----------
/** a = 预警信号等级（0/1/3，3=红警）。算法：
 *  综合 = max(P,T)；a>0 → +1 封顶 3；a==3（红警）→ 3；P≥2 且 T≥2 → 3；封顶 3。 */
export function combineRisk(p: RiskLevel, t: RiskLevel, a: 0 | 1 | 3): RiskLevel {
  if (a === 3) return 3
  let level = Math.max(p, t)
  if (a > 0) level = Math.min(3, level + 1)
  if (p >= 2 && t >= 2) level = 3
  return level as RiskLevel
}

// ---------- 村级降水口径（需求 §3.3：村界覆盖网格点取数） ----------
export interface VillageDayStat {
  min: number
  max: number
  mean: number
}

/** 村级某日统计：村界覆盖网格点当日值的 min/max/mean（范围+均值）。 */
export function villageDayStats(values: readonly number[]): VillageDayStat {
  const finiteValues = values.filter((v) => Number.isFinite(v))
  if (finiteValues.length === 0) return { min: 0, max: 0, mean: 0 }
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (const v of finiteValues) {
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return { min, max, mean: sum / finiteValues.length }
}

/** 覆盖网格点的 7 天每日值（0~6 索引，与 days 对齐）。 */
export function coveredDayValues(covered: readonly PrecipGridPoint[], day: PrecipDayKey): number[] {
  return covered.map((point) => dayValue(point, day))
}

export interface VillagePeak {
  level: RiskLevel
  mm: number
  dayIndex: number
}

/** 7 天窗口峰值：各日村级 max 的最大值（定级用），返回对应日期索引与等级。
 *  连续降雨信号使用每日均值序列（村级代表口径）。 */
export function villagePeak(dailyStats: readonly VillageDayStat[]): VillagePeak {
  let mm = -Infinity
  let dayIndex = 0
  dailyStats.forEach((stat, i) => {
    if (stat.max > mm) {
      mm = stat.max
      dayIndex = i
    }
  })
  return { level: precipPeakLevel(mm), mm: mm === -Infinity ? 0 : mm, dayIndex }
}

/** 村级逐日均值序列（连续降雨信号输入）。 */
export function villageDailyMeans(dailyStats: readonly VillageDayStat[]): number[] {
  return dailyStats.map((stat) => stat.mean)
}

export function dailyStatsForVillage(
  covered: readonly PrecipGridPoint[],
): VillageDayStat[] {
  return PRECIP_DAY_KEYS.map((day) => villageDayStats(coveredDayValues(covered, day)))
}

export type { PrecipGridPoint, PrecipDayKey }
