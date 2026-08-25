

/** 长势 5 级 */
export type GrowthLevel = 'veryPoor' | 'poor' | 'normal' | 'good' | 'excellent'
export const GROWTH_LEVELS: GrowthLevel[] = ['veryPoor', 'poor', 'normal', 'good', 'excellent']

/** 5 级分档 NDVI 阈值（极差<0.4 / 较差0.4~<0.55 / 正常0.55~<0.7 / 较好0.7~<0.8 / 极好>=0.8） */
export const LEVEL_THRESHOLDS: readonly number[] = [0.4, 0.55, 0.7, 0.8]

export const LEVEL_LABELS: Record<GrowthLevel, string> = {
  veryPoor: '极差',
  poor: '较差',
  normal: '正常',
  good: '较好',
  excellent: '极好',
}

/** 5 级颜色（连续色斑：档位色 + 平滑插值带） */
export const LEVEL_COLORS: Record<GrowthLevel, readonly [number, number, number]> = {
  veryPoor: [153, 27, 27],   // 深红（极差）
  poor: [234, 88, 12],       // 橙（较差）
  normal: [250, 204, 21],    // 黄（正常）
  good: [34, 197, 94],       // 绿（较好）
  excellent: [16, 122, 87],  // 深绿（极好）
}

/** 连续色阶：档位色锚点（值 → 颜色），在锚点间线性插值形成连续渐变 */
const COLOR_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0.35, LEVEL_COLORS.veryPoor],
  [0.475, LEVEL_COLORS.poor],
  [0.625, LEVEL_COLORS.normal],
  [0.75, LEVEL_COLORS.good],
  [0.85, LEVEL_COLORS.excellent],
]

/** NDVI 连续值 → 5 级颜色（档位色锚点间平滑插值；NaN/越界返回 null=透明） */
export function ndviColor(value: number, alpha: number): string | null {
  if (!Number.isFinite(value) || alpha <= 0) return null
  let stop = COLOR_STOPS[0]
  let idx = 0
  for (let i = 0; i < COLOR_STOPS.length; i++) {
    if (value >= COLOR_STOPS[i][0]) { stop = COLOR_STOPS[i]; idx = i }
  }
  const prev = idx > 0 ? COLOR_STOPS[idx - 1] : null
  let r: number; let g: number; let b: number
  if (prev) {
    const span = stop[0] - prev[0]
    const t = span > 0 ? Math.min(1, Math.max(0, (value - prev[0]) / span)) : 0
    r = Math.round(prev[1][0] + (stop[1][0] - prev[1][0]) * t)
    g = Math.round(prev[1][1] + (stop[1][1] - prev[1][1]) * t)
    b = Math.round(prev[1][2] + (stop[1][2] - prev[1][2]) * t)
  } else {
    ;[r, g, b] = stop[1]
  }
  return `rgba(${r},${g},${b},${Math.min(1, Math.max(0, alpha)).toFixed(3)})`
}

export function growthLevelOf(value: number): GrowthLevel {
  if (value < LEVEL_THRESHOLDS[0]) return 'veryPoor'
  if (value < LEVEL_THRESHOLDS[1]) return 'poor'
  if (value < LEVEL_THRESHOLDS[2]) return 'normal'
  if (value < LEVEL_THRESHOLDS[3]) return 'good'
  return 'excellent'
}

// ---------- 数据模型（结构化紧凑栅格：左下角 origin，lat 升序，0=无数据/透明） ----------
export interface NdviRaster {
  originLon: number
  originLat: number
  stepLon: number
  stepLat: number
  cols: number
  rows: number
  dates: string[]
  layers: number[][] // [dateIndex][cellIndex] NDVI×100 整数，0=无数据（云/海/省外/非植被）
}

export interface VillageGrowth {
  code: string; name: string
  centroid: { lon: number; lat: number; name: string }
  insuredAreaMu: number; householdCount: number; policyCount: number
  levels: Record<GrowthLevel, number>; anomalyRatio: number; isAnomaly: boolean
  countyCode: string; cityCode: string; townshipCode: string; data: boolean
}

export interface LevelAggregate {
  code: string; name: string; insuredAreaMu: number; householdCount: number
  levels: Record<GrowthLevel, number>; data: boolean
}

export interface PolicyGrowthRow {
  policyId: string; policyNo: string; insuredName: string; insuredPartyId: string
  insuredAreaMu: number; levels: Record<GrowthLevel, number>; premiumRate: string
}

export type TaskStatus = '待下发' | '待领取' | '进行中' | '已完成'
export const TASK_STATUSES: TaskStatus[] = ['待下发', '待领取', '进行中', '已完成']

export interface AgriTask {
  id: string; name: string; type: string; typeName: string
  villageCode: string; villageName: string; status: TaskStatus; createdAt: string
  executor: { name: string; role: string } | null
  remark: string; sopAction: string; requirement: string
  location: { name: string; lon: number; lat: number }
  evidence: Array<{ url: string; time: string }>
}

export type AgriTab = 'overview' | 'anomaly' | 'tasks'
