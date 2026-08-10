export type PrecipDayKey = 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'd7'
export type PrecipDailyValues = Record<PrecipDayKey, number>

export interface PrecipGridPoint {
  lat: number
  lon: number
  values: PrecipDailyValues
}

export interface PrecipitationSnapshot {
  grid: PrecipGridPoint[]
  days: string[] // yyyy-mm-dd，聚合起算日期起 7 天
  coveredDays: number
  model: string
  updatedAt: string
  aggregateFrom: string
  stale?: boolean
  refreshError?: string
}

export const PRECIP_DAY_KEYS: PrecipDayKey[] = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']

export function dayValue(point: PrecipGridPoint, day: PrecipDayKey): number {
  const value = point.values[day]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** 中国气象局 24h 雨量等级：当日累计 mm → 分级文案（悬停浮窗用）。 */
export function precipitationLevel(value: number): string {
  if (value < 0.1) return '无雨'
  if (value < 10) return '小雨'
  if (value < 25) return '中雨'
  if (value < 50) return '大雨'
  if (value < 100) return '暴雨'
  if (value < 250) return '大暴雨'
  return '特大暴雨'
}
