import { buildForecastSnapshot } from './typhoonForecast'
import { typhoonPointStyle } from './typhoonStyles'
import { parseBeijingDateTime, stableTimeSort } from './typhoonTime'
import type { ObservationNode, TyphoonDetail, TyphoonStatus, TyphoonSummary, WindRadius } from './typhoonTypes'

const REFERENCE_FIELDS = ['reference_position_text', 'reference_text', 'official_position_text'] as const

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function status(value: unknown): TyphoonStatus | null { return value === 'start' || value === 'stop' ? value : null }
function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : null
}
function optionalString(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }
function finite(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function optionalNumber(value: unknown): number | undefined { return value === null || value === undefined || value === '' ? undefined : finite(value) ?? undefined }

function adaptSummaryRecord(raw: unknown, sourceIndex: number): TyphoonSummary | null {
  const item = object(raw)
  const id = item && identifier(item.no1)
  const type = item && status(item.type)
  if (!item || !id || !type) return null
  return {
    id,
    domesticNo: identifier(item.no2) ?? undefined,
    internationalNo: identifier(item.no3) ?? undefined,
    otherNo: identifier(item.no4) ?? undefined,
    nameCn: optionalString(item.namecn) ?? '',
    nameEn: optionalString(item.nameen) ?? '',
    explanation: optionalString(item.explanation),
    status: type,
    sourceIndex,
  }
}

export function adaptTyphoonList(raw: unknown): { summaries: TyphoonSummary[]; anomalies: string[] } {
  const root = object(raw)
  if (!root || root.code !== 200 || !Array.isArray(root.list)) return { summaries: [], anomalies: ['台风列表结构无效'] }
  const summaries: TyphoonSummary[] = []
  const anomalies: string[] = []
  root.list.forEach((item, index) => {
    const summary = adaptSummaryRecord(item, index)
    if (summary) summaries.push(summary)
    else anomalies.push(`list[${index}] 无效`)
  })
  return { summaries, anomalies }
}

function adaptWindRadii(raw: unknown): WindRadius[] {
  if (!Array.isArray(raw)) return []
  const result: WindRadius[] = []
  for (const entry of raw) {
    const item = object(entry)
    if (!item) continue
    const grade = identifier(item.grade)
    const ne = finite(item.ne_radius_km)
    const se = finite(item.se_radius_km)
    const sw = finite(item.sw_radius_km)
    const nw = finite(item.nw_radius_km)
    if (!grade || ne === null || se === null || sw === null || nw === null || [ne, se, sw, nw].some((value) => value <= 0)) continue
    result.push({ grade, gradeText: optionalString(item.grade_text), gradeDescription: optionalString(item.grade_desc), neRadiusKm: ne, seRadiusKm: se, swRadiusKm: sw, nwRadiusKm: nw })
  }
  return result
}

function officialReference(item: Record<string, unknown>): string | undefined {
  for (const field of REFERENCE_FIELDS) {
    const value = optionalString(item[field])
    if (value) return value
  }
  return undefined
}

function adaptObservation(raw: unknown, typhoonId: string, type: TyphoonStatus, sourceIndex: number): ObservationNode | null {
  const item = object(raw)
  if (!item) return null
  const timeYmdh = optionalString(item.time_ymdh)
  const epochMs = parseBeijingDateTime(timeYmdh)
  const lat = finite(item.lat)
  const lon = finite(item.lon)
  const windSpeedMs = finite(item.wind_speed_ms)
  if (!timeYmdh || epochMs === null || lat === null || lat < -90 || lat > 90 || lon === null || lon < -180 || lon > 180
    || windSpeedMs === null || !typhoonPointStyle(windSpeedMs)) return null
  const id = `${typhoonId}:obs:${sourceIndex}`
  return {
    id,
    sourceIndex,
    timeYmdh,
    epochMs,
    lat,
    lon,
    windSpeedMs,
    pressureHpa: optionalNumber(item.pressure_hpa),
    intensityCode: optionalString(item.intensity_code),
    intensityText: optionalString(item.intensity_text),
    intensityDescription: optionalString(item.intensity_desc),
    positionText: optionalString(item.position_text),
    moveDirectionCode: optionalString(item.move_dir_code),
    moveDirectionText: optionalString(item.move_dir_text),
    moveSpeedKmh: optionalNumber(item.move_speed_kmh),
    moveDescription: optionalString(item.move_desc),
    officialReferenceText: officialReference(item),
    windRadii: adaptWindRadii(item.wind_radius),
    forecastSnapshot: buildForecastSnapshot(id, item.forecast_babj, type),
  }
}

export function adaptTyphoonDetail(raw: unknown): TyphoonDetail | null {
  const root = object(raw)
  const summary = root && root.code === 200 ? adaptSummaryRecord(root, 0) : null
  if (!root || !summary || !Array.isArray(root.datas)) return null
  const observationsApiOrder: ObservationNode[] = []
  const anomalies: string[] = []
  root.datas.forEach((item, sourceIndex) => {
    const node = adaptObservation(item, summary.id, summary.status, sourceIndex)
    if (node) observationsApiOrder.push(node)
    else anomalies.push(`datas[${sourceIndex}] 无法渲染`)
  })
  const observationsAsc = stableTimeSort(observationsApiOrder)
  const observationsDesc = stableTimeSort(observationsApiOrder, 'desc')
  return { ...summary, observationsApiOrder, observationsAsc, observationsDesc, latestObservation: observationsDesc[0] ?? null, anomalies }
}
