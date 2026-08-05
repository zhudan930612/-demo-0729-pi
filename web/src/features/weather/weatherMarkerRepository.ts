import type { Level } from '../../stores/drilldown'
import { weatherMarkersApi } from '../../api/weatherMarkers'
import type { ModuleError, WeatherMarkerSummary, WeatherMarkerTarget } from './weatherTypes'

export interface WeatherMarkerSink {
  /** 打开新层级流：返回 generation，用于拒绝旧流事件。 */
  begin(level: Level, code: string): number
  targets(generation: number, level: Level, code: string, targets: WeatherMarkerTarget[]): boolean
  ready(generation: number, code: string, summary: WeatherMarkerSummary): boolean
  fail(generation: number, code: string, error: ModuleError): boolean
  /** 整条流失败（例如骨架前错误）。 */
  streamFail(generation: number, error: ModuleError): boolean
}
export interface WeatherMarkerRepository {
  open(level: Level, code: string, refresh?: boolean): void
  retry(): void
  close(): void
  startAutoRefresh(): void
  stopAutoRefresh(): void
  exit(): void
}
export interface WeatherMarkersApiClient {
  stream(query: { contextLevel: Level; contextCode: string }, sink: { onTargets(level: Level, code: string, targets: WeatherMarkerTarget[]): void; onReady(code: string, summary: WeatherMarkerSummary): void; onError(code: string, error: ModuleError): void; onEnd?(error?: ModuleError): void }, signal?: AbortSignal): { cancel(): void; finished: Promise<void> }
}

export function createWeatherMarkerRepository(sink: WeatherMarkerSink, options: { api?: WeatherMarkersApiClient; intervalMs?: number; now?: () => number; document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>; setInterval?: typeof setInterval; clearInterval?: typeof clearInterval } = {}): WeatherMarkerRepository {
  const api = options.api ?? weatherMarkersApi
  const intervalMs = options.intervalMs ?? 600000
  const now = options.now ?? Date.now
  const doc = options.document ?? globalThis.document
  const setI = options.setInterval ?? globalThis.setInterval
  const clearI = options.clearInterval ?? globalThis.clearInterval
  let active: { controller: AbortController; level: Level; code: string; generation: number; handle: ReturnType<WeatherMarkersApiClient['stream']> } | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let lastSuccess = 0

  function open(level: Level, code: string) {
    active?.handle.cancel()
    const controller = new AbortController()
    const generation = sink.begin(level, code)
    const handle = api.stream({ contextLevel: level, contextCode: code }, {
      onTargets(targetLevel, targetCode, targets) {
        if (active?.controller !== controller || targetLevel !== level || targetCode !== code) return
        if (sink.targets(generation, level, code, targets)) lastSuccess = now()
      },
      onReady(markerCode, summary) {
        if (active?.controller !== controller) return
        if (sink.ready(generation, markerCode, summary)) lastSuccess = now()
      },
      onError(markerCode, error) {
        if (active?.controller !== controller) return
        sink.fail(generation, markerCode, error)
      },
      onEnd(error) {
        if (active?.controller !== controller) return
        if (error) sink.streamFail(generation, error)
      },
    }, controller.signal)
    active = { controller, level, code, generation, handle }
  }
  function retry() {
    if (active) open(active.level, active.code)
  }
  function close() {
    active?.handle.cancel()
    active = null
  }
  function exit() {
    stopAutoRefresh()
    close()
  }
  const onVisibility = () => {
    if (doc?.visibilityState === 'visible' && active && now() - lastSuccess >= intervalMs) retry()
  }
  function startAutoRefresh() {
    if (timer) return
    timer = setI(() => {
      if ((!doc || doc.visibilityState === 'visible') && active) retry()
    }, intervalMs)
    doc?.addEventListener('visibilitychange', onVisibility)
  }
  function stopAutoRefresh() {
    if (timer) { clearI(timer); timer = null }
    doc?.removeEventListener('visibilitychange', onVisibility)
  }
  return { open, retry, close, startAutoRefresh, stopAutoRefresh, exit }
}
