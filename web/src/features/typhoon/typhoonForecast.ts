import { typhoonPointStyle } from './typhoonStyles'
import type { ForecastNode, ForecastSnapshot, TyphoonStatus } from './typhoonTypes'

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function optionalNumber(value: unknown): number | undefined {
  return value === undefined || value === null || value === '' ? undefined : finite(value) ?? undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function buildForecastSnapshot(
  observationId: string,
  raw: unknown,
  status: TyphoonStatus,
  historicalVersionConfirmed = false,
): ForecastSnapshot | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const nodes: ForecastNode[] = []
  for (let sourceIndex = 0; sourceIndex < raw.length; sourceIndex += 1) {
    const item = object(raw[sourceIndex])
    if (!item) return null
    const forecastHour = finite(item.forecast_hour)
    const lat = finite(item.lat)
    const lon = finite(item.lon)
    const windSpeedMs = finite(item.wind_speed_ms)
    if (forecastHour === null || forecastHour < 0 || lat === null || lat < -90 || lat > 90
      || lon === null || lon < -180 || lon > 180 || windSpeedMs === null || !typhoonPointStyle(windSpeedMs)) return null
    nodes.push({
      id: `${observationId}:forecast:${sourceIndex}`,
      sourceIndex,
      forecastHour,
      lat,
      lon,
      windSpeedMs,
      pressureHpa: optionalNumber(item.pressure_hpa),
      intensityCode: optionalString(item.intensity_code),
      intensityText: optionalString(item.intensity_text),
      positionText: optionalString(item.position_text),
      targetTimeYmdh: optionalString(item.target_time_ymdh),
      forecastDescription: optionalString(item.forecast_desc),
    })
  }
  nodes.sort((left, right) => left.forecastHour - right.forecastHour || left.sourceIndex - right.sourceIndex)
  return {
    observationId,
    nodes,
    maxForecastHour: Math.max(...nodes.map((node) => node.forecastHour)),
    historicalVersionConfirmed: status === 'start' || historicalVersionConfirmed,
  }
}

export function forecastIsDisplayable(snapshot: ForecastSnapshot | null, status: TyphoonStatus): boolean {
  if (!snapshot) return false
  return status === 'start' || snapshot.historicalVersionConfirmed
}
