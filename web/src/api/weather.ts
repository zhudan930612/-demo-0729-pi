import type { WeatherBundle, WeatherQuery } from '../features/weather/weatherTypes'

export class WeatherApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  constructor(code: string, status: number, message: string, requestId?: string) {
    super(message); this.name = 'WeatherApiError'; this.code = code; this.status = status; this.requestId = requestId
  }
}

function queryParams(query: WeatherQuery): URLSearchParams {
  const params = new URLSearchParams({ contextLevel: query.contextLevel, contextCode: query.contextCode, target: query.target })
  if (query.target !== 'admin') {
    if (!Number.isFinite(query.lat) || !Number.isFinite(query.lon)) throw new WeatherApiError('INVALID_WEATHER_TARGET', 400, '天气查询点无效')
    params.set('lat', String(query.lat)); params.set('lon', String(query.lon))
  }
  return params
}
export function weatherRequestKey(query: WeatherQuery): string {
  return queryParams(query).toString()
}
export interface WeatherApiClient { bundle(query: WeatherQuery, signal?: AbortSignal): Promise<WeatherBundle> }
export function createWeatherApiClient(fetchImpl: typeof fetch = globalThis.fetch): WeatherApiClient {
  return { async bundle(query, signal) {
    const response = await fetchImpl(`/api/weather?${queryParams(query)}`, { headers: { accept: 'application/json' }, signal })
    let payload: unknown
    try { payload = await response.json() } catch { throw new WeatherApiError('INVALID_RESPONSE', response.status, '天气数据响应格式异常') }
    if (!response.ok) {
      const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      const error = root.error && typeof root.error === 'object' ? root.error as Record<string, unknown> : {}
      throw new WeatherApiError(typeof error.code === 'string' ? error.code : 'WEATHER_REQUEST_FAILED', response.status, typeof error.message === 'string' ? error.message : '天气数据加载失败', typeof error.requestId === 'string' ? error.requestId : undefined)
    }
    return payload as WeatherBundle
  } }
}
export const weatherApi = createWeatherApiClient()
