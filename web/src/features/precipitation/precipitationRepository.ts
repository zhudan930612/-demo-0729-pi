import { precipitationApi, type PrecipitationApiClient } from '../../api/precipitation'
import type { PrecipitationSnapshot } from './precipitationTypes'

export interface PrecipitationSink {
  begin(): number
  receive(generation: number, snapshot: PrecipitationSnapshot): boolean
  fail(generation: number, message: string): boolean
}
export interface PrecipitationRepository {
  load(options?: { refresh?: boolean }): Promise<void>
  retry(): Promise<void>
  exit(): void
  hasActive(): boolean
}
function aborted(error: unknown, signal: AbortSignal) { return signal.aborted || (error instanceof Error && error.name === 'AbortError') }
export function createPrecipitationRepository(sink: PrecipitationSink, options: { api?: PrecipitationApiClient } = {}): PrecipitationRepository {
  const api = options.api ?? precipitationApi
  let active: AbortController | null = null
  async function load(_options: { refresh?: boolean } = {}) {
    active?.abort()
    const controller = new AbortController()
    active = controller
    const generation = sink.begin()
    try {
      const snapshot = await api.snapshot(controller.signal)
      if (active !== controller) return
      sink.receive(generation, snapshot)
    } catch (error) {
      if (!aborted(error, controller.signal) && active === controller) {
        sink.fail(generation, error instanceof Error ? error.message : '降水预报数据加载失败')
      }
    }
  }
  async function retry() { await load({ refresh: true }) }
  function exit() { active?.abort(); active = null }
  function hasActive() { return active !== null }
  return { load, retry, exit, hasActive }
}
