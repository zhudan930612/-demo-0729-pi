import type { Level } from '../../stores/drilldown'

export type DisasterViewMode = 'none' | 'weather' | 'typhoon'
export type WeatherModuleKind = 'alerts' | 'current'
export type WeatherTarget = 'admin' | 'parcel' | 'picked' | 'seat'

export interface WeatherQuery {
  contextLevel: Level
  contextCode: string
  contextName: string
  target: WeatherTarget
  lat?: number
  lon?: number
}
export interface UnitValue { value: number | null; unit: string | null }
export interface WeatherCondition { code: string | null; text: string | null }
export interface Attribution { name: string | null; url: string | null }
export interface ModuleError { code: string; message: string }
export interface MinutelyRefer { sources: string[]; license: string[] }
export interface WeatherMetadata { tag?: string | null; zeroResult?: boolean; attributions?: Attribution[]; refer?: MinutelyRefer }
export interface WeatherTiming { fetchedAt?: string; expiresAt?: string; stale?: boolean; refreshError?: ModuleError }
export type WeatherModule<T> =
  | ({ status: 'success'; data: T; metadata?: WeatherMetadata } & WeatherTiming)
  | ({ status: 'empty'; data: T | null; message: string; metadata?: WeatherMetadata } & WeatherTiming)
  | { status: 'error'; error: ModuleError }
export interface CurrentWeather {
  condition: WeatherCondition
  temperature: UnitValue
  feelsLike: UnitValue | null
  precipitation: { amount: UnitValue | null; intensity: UnitValue | null; type: string | null } | null
  humidity: number | null
}
export interface MinutelyItem { fxTime: string; precip: number; type: string | null }
export interface MinutelyForecast { updateTime: string | null; summary: string | null; minutely: MinutelyItem[]; refer: MinutelyRefer }
export interface HourlyItem { forecastTime: string; condition: WeatherCondition; temperature: UnitValue; precipitation: { probability: number | null; amount: UnitValue | null } | null }
export interface AddressData { address: string; hctype: number | null; jd: string | null }
export interface WeatherAlert {
  id: string
  headline: string | null
  issuedTime: string | null
  urgency: string | null
  severity: string | null
  certainty: string | null
  description: string | null
  criteria: string | null
  instruction: string | null
  senderName: string | null
  eventType: { name: string | null; code: string | null } | null
  icon: string | null
  color: { code: string | null; red: number | null; green: number | null; blue: number | null; alpha: number | null } | null
  matchedContextCodes?: string[]
}
export interface AlertRegion extends WeatherTiming {
  code: string
  name: string
  point: [number, number]
  status: 'success' | 'empty' | 'error'
  alerts?: WeatherAlert[]
  error?: ModuleError
  metadata?: WeatherMetadata
}
export interface AlertModule {
  status: 'success' | 'empty' | 'error' | 'partial'
  data: AlertRegion[]
  details?: WeatherAlert[]
  message?: string
  error?: ModuleError
}
export interface WeatherBundle {
  contextLevel: Level
  contextCode: string
  target: WeatherTarget
  location: { lat: number; lon: number }
  originalLocation: { lat: number; lon: number }
  fetchedAt: string
  address: WeatherModule<AddressData>
  current: WeatherModule<CurrentWeather>
  alerts: AlertModule
  minutely: WeatherModule<MinutelyForecast>
  hourly: WeatherModule<HourlyItem[]>
  attributions: Attribution[]
}
export type LocationPopupKind = 'none' | 'default' | 'picked'
export interface WeatherSelection { contextCode: string; alertId: string }

// ---- 多级政府驻地天气标牌（/api/weather/markers）----
export type WeatherMarkerLevel = 'city' | 'county' | 'township'
export interface WeatherMarkerTarget {
  code: string
  level: WeatherMarkerLevel
  name: string
  /** 可信政府驻地坐标（服务端校验后返回，不含查询词/评分/来源） */
  location: { lat: number; lon: number }
}
export interface WeatherMarkerSummary {
  condition: WeatherCondition | null
  temperature: UnitValue | null
  high: UnitValue | null
  low: UnitValue | null
  fetchedAt: string
}
export type WeatherMarkerPhase = 'loading' | 'ready' | 'error'
export interface WeatherMarkerState {
  phase: WeatherMarkerPhase
  summary?: WeatherMarkerSummary
  error?: ModuleError
}
export type WeatherMarkersEvent =
  | { type: 'targets'; contextLevel: Level; contextCode: string; total: number; targets: WeatherMarkerTarget[] }
  | { type: 'ready'; code: string; summary: WeatherMarkerSummary }
  | { type: 'error'; code: string; error: ModuleError }
