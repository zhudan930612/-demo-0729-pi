import type { Level } from '../stores/drilldown'
import type { WeatherMarkerSummary, WeatherMarkerTarget, WeatherMarkersEvent } from '../features/weather/weatherTypes'

export class WeatherMarkersApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'WeatherMarkersApiError'
    this.code = code
    this.status = status
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}
function unit(value: unknown): { value: number | null; unit: string | null } | null {
  const item = record(value)
  if (!item) return null
  const number = typeof item.value === 'number' && Number.isFinite(item.value) ? item.value : null
  return { value: number, unit: typeof item.unit === 'string' ? item.unit : null }
}
function condition(value: unknown): { code: string | null; text: string | null } | null {
  const item = record(value)
  if (!item) return null
  return { code: typeof item.code === 'string' ? item.code : null, text: typeof item.text === 'string' ? item.text : null }
}
export function isWeatherMarkersEvent(value: unknown): value is WeatherMarkersEvent {
  const item = record(value)
  if (!item || typeof item.type !== 'string') return false
  if (item.type === 'targets') {
    const targets = item.targets
    return Array.isArray(targets) && targets.every((target) => {
      const t = record(target), location = record(t?.location)
      return Boolean(t && typeof t.code === 'string' && ['city', 'county', 'township'].includes(String(t.level)) && typeof t.name === 'string' && Number.isFinite(location?.lat) && Number.isFinite(location?.lon))
    })
  }
  if (item.type === 'ready') {
    const summary = record(item.summary)
    return Boolean(summary && typeof summary.fetchedAt === 'string' && 'condition' in summary && 'high' in summary && 'low' in summary)
  }
  if (item.type === 'error') {
    const error = record(item.error)
    return Boolean(error && typeof error.code === 'string' && typeof error.message === 'string')
  }
  return false
}
export function markerSummaryOf(event: WeatherMarkersEvent & { type: 'ready' }): WeatherMarkerSummary {
  const summary = record(event.summary)
  return {
    condition: condition(summary?.condition),
    temperature: unit(summary?.temperature),
    high: unit(summary?.high),
    low: unit(summary?.low),
    fetchedAt: typeof summary?.fetchedAt === 'string' ? summary.fetchedAt : new Date().toISOString(),
  }
}

export interface WeatherMarkersStreamSink {
  onTargets(level: Level, code: string, targets: WeatherMarkerTarget[]): void
  onReady(code: string, summary: WeatherMarkerSummary): void
  onError(code: string, error: { code: string; message: string }): void
  onEnd?(error?: { code: string; message: string }): void
}
export interface WeatherMarkerStreamHandle { cancel(): void; finished: Promise<void> }

export function createWeatherMarkersApi(fetchImpl: typeof fetch = globalThis.fetch) {
  function stream(query: { contextLevel: Level; contextCode: string }, sink: WeatherMarkersStreamSink, signal?: AbortSignal): WeatherMarkerStreamHandle {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const params = new URLSearchParams({ contextLevel: query.contextLevel, contextCode: query.contextCode })
    const finished = (async () => {
      try {
        const response = await fetchImpl(`/api/weather/markers?${params}`, { headers: { accept: 'application/x-ndjson' }, signal: controller.signal })
        if (!response.ok) {
          let message = '天气标牌数据加载失败'
          try {
            const payload = await response.json() as { error?: { code?: string; message?: string } }
            message = payload.error?.message || message
          } catch { /* 保持默认 */ }
          throw new WeatherMarkersApiError('WEATHER_MARKERS_REQUEST_FAILED', response.status, message)
        }
        const text = await response.text()
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          let parsed: unknown
          try { parsed = JSON.parse(line) } catch { continue }
          if (!isWeatherMarkersEvent(parsed)) continue
          if (parsed.type === 'targets') sink.onTargets(parsed.contextLevel, parsed.contextCode, parsed.targets)
          else if (parsed.type === 'ready') sink.onReady(parsed.code, markerSummaryOf(parsed))
          else sink.onError(parsed.code, parsed.error)
        }
        sink.onEnd?.()
      } catch (error) {
        if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) return
        sink.onEnd?.({ code: 'WEATHER_MARKERS_STREAM_FAILED', message: error instanceof Error ? error.message : '天气标牌数据加载失败' })
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    })()
    return {
      cancel() { controller.abort() },
      finished,
    }
  }
  return { stream }
}
export const weatherMarkersApi = createWeatherMarkersApi()
