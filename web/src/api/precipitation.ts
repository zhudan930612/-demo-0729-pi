import type { PrecipitationSnapshot, PrecipDayKey, PrecipGridPoint } from '../features/precipitation/precipitationTypes'
import { PRECIP_DAY_KEYS } from '../features/precipitation/precipitationTypes'

export class PrecipitationApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  constructor(code: string, status: number, message: string, requestId?: string) {
    super(message); this.name = 'PrecipitationApiError'; this.code = code; this.status = status; this.requestId = requestId
  }
}

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }

export function isPrecipitationSnapshot(value: unknown): value is PrecipitationSnapshot {
  const root = record(value)
  if (!root || !Array.isArray(root.grid) || !Array.isArray(root.days) || typeof root.coveredDays !== 'number' || typeof root.model !== 'string' || typeof root.updatedAt !== 'string' || typeof root.aggregateFrom !== 'string') return false
  if (root.days.length !== PRECIP_DAY_KEYS.length) return false
  return root.grid.every((item: unknown) => {
    const point = record(item)
    if (!point || typeof point.lat !== 'number' || typeof point.lon !== 'number') return false
    const values = record(point.values)
    if (!values) return false
    return PRECIP_DAY_KEYS.every((key) => typeof values[key] === 'number' && Number.isFinite(values[key]))
  })
}

export function pointValue(point: PrecipGridPoint, day: PrecipDayKey): number {
  const value = point.values[day]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export interface PrecipitationApiClient { snapshot(signal?: AbortSignal): Promise<PrecipitationSnapshot> }
export function createPrecipitationApiClient(fetchImpl: typeof fetch = globalThis.fetch): PrecipitationApiClient {
  return { async snapshot(signal) {
    const response = await fetchImpl('/api/precipitation-grid', { headers: { accept: 'application/json' }, signal })
    let payload: unknown
    try { payload = await response.json() } catch { throw new PrecipitationApiError('INVALID_RESPONSE', response.status, '降水预报数据响应格式异常') }
    if (!response.ok) {
      const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      const error = root.error && typeof root.error === 'object' ? root.error as Record<string, unknown> : {}
      throw new PrecipitationApiError(typeof error.code === 'string' ? error.code : 'PRECIPITATION_REQUEST_FAILED', response.status, typeof error.message === 'string' ? error.message : '降水预报数据加载失败', typeof error.requestId === 'string' ? error.requestId : undefined)
    }
    if (!isPrecipitationSnapshot(payload)) throw new PrecipitationApiError('INVALID_RESPONSE', response.status, '降水预报数据响应结构异常')
    return payload
  } }
}
export const precipitationApi = createPrecipitationApiClient()
