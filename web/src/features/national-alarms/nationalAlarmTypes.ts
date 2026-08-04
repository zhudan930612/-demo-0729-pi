import type { Level } from '../../stores/drilldown'

export type NationalAlarmLevel = 'province' | 'city' | 'county' | 'unknown'
export type NationalAlarmSeverity = 'red' | 'orange' | 'yellow' | 'blue' | 'unknown'
export interface NationalWeatherAlarm {
  id: string; issuedAt: string | null; title: string; iconUrl: string | null; adminCode: string | null
  adminLevel: NationalAlarmLevel; provinceCode: '33'; provinceName: '浙江省'; eventType: string | null; severity: NationalAlarmSeverity
  mappableInZhejiang: boolean; mapLocation: { status: 'mapped' | 'unmapped'; point?: [number, number]; groupCount?: number }
}
export interface ZhejiangAlarmDetail { id: string; issuedAt: string | null; body: string | null }
export interface NationalAlarmSnapshot { items: NationalWeatherAlarm[]; summary: { total: number; snapshotTotal: number }; fetchedAt: string; expiresAt: string; source: string; stale?: boolean; refreshError?: { code: string; message: string } }
export type NationalAlarmPhase = 'closed' | 'loading' | 'ready' | 'error' | 'refreshing'
export interface NationalAlarmSelection { id: string; source: 'list' | 'map' }
export interface NationalAlarmDetailState { id: string; phase: 'loading' | 'ready' | 'error'; body: string | null; retryAvailable: boolean }
export interface NationalAlarmMapContext { level: Level; code: string; countyCode?: string | null }
