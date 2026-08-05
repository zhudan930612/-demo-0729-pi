import { describe, expect, it, vi } from 'vitest'
import { isWeatherMarkersEvent, markerSummaryOf, createWeatherMarkersApi } from './weatherMarkers'
import type { WeatherMarkersEvent } from '../features/weather/weatherTypes'

const targetsEvent = (): WeatherMarkersEvent => ({ type: 'targets', contextLevel: 'county', contextCode: '330101', total: 2, targets: [
  { code: '330101001000', level: 'township', name: '示例乡', location: { lat: 30, lon: 120 } },
  { code: '330101002000', level: 'township', name: '示例乡乙', location: { lat: 29.75, lon: 120 } },
] })
const readyEvent = (): WeatherMarkersEvent & { type: 'ready' } => ({ type: 'ready', code: '330101001000', summary: { condition: { code: '100', text: '晴' }, temperature: { value: 26, unit: '°C' }, high: { value: 33, unit: '°C' }, low: { value: 24, unit: '°C' }, fetchedAt: '2026-08-05T00:00:00.000Z' } })
const errorEvent = (): WeatherMarkersEvent => ({ type: 'error', code: '330101001000', error: { code: 'WEATHER_UPSTREAM_ERROR', message: '天气模块暂时不可用' } })

describe('weather markers api', () => {
  it('事件结构校验接受白名单字段并拒绝越权字段形态', () => {
    expect(isWeatherMarkersEvent(targetsEvent())).toBe(true)
    expect(isWeatherMarkersEvent(readyEvent())).toBe(true)
    expect(isWeatherMarkersEvent(errorEvent())).toBe(true)
    expect(isWeatherMarkersEvent({ type: 'targets', contextLevel: 'county', contextCode: '330101', total: 1, targets: [{ code: '330101001000', level: 'township', name: '示例乡', location: { lat: 30, lon: 120 }, query: 'secret' }] })).toBe(true) // 多余字段不做展示，不拒绝
    expect(isWeatherMarkersEvent({ type: 'targets', contextLevel: 'county', contextCode: '330101', total: 1, targets: [{ code: '330101001000', level: 'province', name: '示例乡', location: { lat: 30, lon: 120 } }] })).toBe(false)
    expect(isWeatherMarkersEvent({ type: 'targets', contextLevel: 'county', contextCode: '330101', total: 1, targets: [{ code: '330101001000', level: 'township', name: '示例乡', location: { lat: 'NaN', lon: 120 } }] })).toBe(false)
    expect(isWeatherMarkersEvent({ type: 'ready', code: 'x' })).toBe(false)
    expect(isWeatherMarkersEvent({ type: 'error', code: 'x', error: {} })).toBe(false)
    expect(isWeatherMarkersEvent({ type: 'other' })).toBe(false)
    expect(markerSummaryOf(readyEvent()).high).toEqual({ value: 33, unit: '°C' })
  })
  it('按行解析 NDJSON：先骨架后 ready/error，非 JSON 行跳过', async () => {
    const lines = [JSON.stringify(targetsEvent()), 'not-json', JSON.stringify(readyEvent()), JSON.stringify(errorEvent())].join('\n')
    const events: string[] = []
    const sink = {
      onTargets: vi.fn((_l: string, _c: string, targets: unknown[]) => events.push(`targets:${targets.length}`)),
      onReady: vi.fn((code: string) => events.push(`ready:${code}`)),
      onError: vi.fn((code: string) => events.push(`error:${code}`)),
    }
    const api = createWeatherMarkersApi(async () => new Response(lines, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }))
    await api.stream({ contextLevel: 'county', contextCode: '330101' }, sink).finished
    expect(events).toEqual(['targets:2', 'ready:330101001000', 'error:330101001000'])
  })
  it('HTTP 失败或中止时上报流错误并支持取消', async () => {
    const sink = { onTargets: vi.fn(), onReady: vi.fn(), onError: vi.fn(), onEnd: vi.fn() }
    const api = createWeatherMarkersApi(async () => new Response(JSON.stringify({ error: { code: 'X', message: '坏请求' } }), { status: 400 }))
    await api.stream({ contextLevel: 'county', contextCode: '330101' }, sink).finished
    expect(sink.onEnd).toHaveBeenCalledTimes(1)
    const abort = new AbortController()
    const hanging = createWeatherMarkersApi(async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))))
    const handle = hanging.stream({ contextLevel: 'county', contextCode: '330101' }, sink, abort.signal)
    handle.cancel()
    await handle.finished
    expect(sink.onEnd).toHaveBeenCalledTimes(1) // 主动取消不触发流错误
  })
})
