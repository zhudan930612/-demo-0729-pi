import { describe, expect, it, vi } from 'vitest'
import { createWeatherMarkerRepository } from './weatherMarkerRepository'
import type { WeatherMarkerTarget } from './weatherTypes'

const targets: WeatherMarkerTarget[] = [{ code: '330101001000', level: 'township', name: '示例乡', location: { lat: 30, lon: 120 } }]
const ready = { condition: { code: '100', text: '晴' }, temperature: { value: 26, unit: '°C' }, high: { value: 33, unit: '°C' }, low: { value: 24, unit: '°C' }, fetchedAt: '2026-08-05T00:00:00.000Z' }
function sink() {
  let generation = 0
  return {
    begin: vi.fn(() => ++generation),
    targets: vi.fn(() => true),
    ready: vi.fn(() => true),
    fail: vi.fn(() => true),
    streamFail: vi.fn(() => true),
  }
}
function client() {
  const handles: { cancel: ReturnType<typeof vi.fn>; finished: Promise<void> }[] = []
  const stream = vi.fn((_query: { contextLevel: string; contextCode: string }, _sink: { onTargets(...args: unknown[]): void; onReady(...args: unknown[]): void; onError(...args: unknown[]): void; onEnd?(error?: unknown): void }) => {
    const handle = { cancel: vi.fn(), finished: Promise.resolve() }
    handles.push(handle)
    return handle
  })
  return { handles, stream }
}

describe('weather marker repository', () => {
  it('open 后先发骨架再逐项 ready/error', async () => {
    const s = sink()
    const api = client()
    const r = createWeatherMarkerRepository(s, { api: api as never, document: undefined })
    r.open('county', '330101')
    const streamCall = api.stream.mock.calls.at(-1)!
    const apiSink = streamCall[1] as { onTargets(level: string, code: string, targets: WeatherMarkerTarget[]): void; onReady(code: string, summary: typeof ready): void; onError(code: string, error: { code: string; message: string }): void }
    apiSink.onTargets('county', '330101', targets)
    expect(s.targets).toHaveBeenCalledTimes(1)
    apiSink.onReady('330101001000', ready)
    expect(s.ready).toHaveBeenCalledTimes(1)
    r.close()
    expect(api.handles[0].cancel).toHaveBeenCalled()
  })
  it('再次 open 取消旧流，旧流迟到事件被 generation 拒绝', async () => {
    const s = sink()
    const api = client()
    const r = createWeatherMarkerRepository(s, { api: api as never, document: undefined })
    r.open('county', '330101')
    const firstSink = api.stream.mock.calls[0]![1]
    r.open('city', '330100')
    expect(api.handles[0].cancel).toHaveBeenCalled()
    firstSink.onReady('330101001000', ready)
    expect(s.ready).toHaveBeenCalledTimes(0)
    const secondSink = api.stream.mock.calls[1]![1]
    secondSink.onReady('330100', ready)
    expect(s.ready).toHaveBeenCalledTimes(1)
  })
  it('定时刷新只作用于当前层级流，退出后停止', async () => {
    vi.useFakeTimers()
    let visible: 'visible' | 'hidden' = 'visible'
    const listeners = new Set<() => void>()
    const doc = {
      get visibilityState() { return visible },
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    }
    const s = sink()
    const api = client()
    const r = createWeatherMarkerRepository(s, { api: api as never, document: doc as never, intervalMs: 600000, now: () => Date.now() })
    r.open('county', '330101')
    r.startAutoRefresh()
    await vi.advanceTimersByTimeAsync(600000)
    expect(api.stream).toHaveBeenCalledTimes(2)
    r.exit()
    await vi.advanceTimersByTimeAsync(600000)
    expect(api.stream).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
