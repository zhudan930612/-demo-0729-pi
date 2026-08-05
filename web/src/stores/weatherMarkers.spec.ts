import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWeatherMarkersStore } from './weatherMarkers'
import type { WeatherMarkerTarget } from '../features/weather/weatherTypes'

const targets: WeatherMarkerTarget[] = [
  { code: '330101002000', level: 'township', name: '示例乡乙', location: { lat: 29.75, lon: 120 } },
  { code: '330101001000', level: 'township', name: '示例乡', location: { lat: 30, lon: 120 } },
]
const ready = { condition: { code: '100', text: '晴' }, temperature: { value: 26, unit: '°C' }, high: { value: 33, unit: '°C' }, low: { value: 24, unit: '°C' }, fetchedAt: '2026-08-05T00:00:00.000Z' }

describe('weather markers store', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('骨架就绪后按代码稳定排序，逐项 ready/error 独立替换', () => {
    const store = useWeatherMarkersStore()
    const generation = store.begin('county', '330101')
    expect(store.phase).toBe('loading')
    store.setTargets(generation, 'county', '330101', targets)
    expect(store.order).toEqual(['330101001000', '330101002000'])
    expect(store.list.map((item) => item.name)).toEqual(['示例乡', '示例乡乙'])
    expect(store.list.every((item) => item.state.phase === 'loading')).toBe(true)
    store.setReady(generation, '330101001000', ready)
    expect(store.list[0]!.state.phase).toBe('ready')
    expect(store.list[1]!.state.phase).toBe('loading')
    store.setFail(generation, '330101002000', { code: 'WEATHER_UPSTREAM_ERROR', message: '失败' })
    expect(store.phase).toBe('ready')
    expect(store.readyCount).toBe(1)
    expect(store.errorCount).toBe(1)
  })
  it('空骨架直接进入 ready（乡镇/村无预置标牌）', () => {
    const store = useWeatherMarkersStore()
    const generation = store.begin('township', '330101001000')
    store.setTargets(generation, 'township', '330101001000', [])
    expect(store.phase).toBe('ready')
    expect(store.total).toBe(0)
  })
  it('旧层级流事件不会写入新层级', () => {
    const store = useWeatherMarkersStore()
    const first = store.begin('county', '330101')
    const second = store.begin('city', '330100')
    expect(store.setTargets(first, 'county', '330101', targets)).toBe(false)
    expect(store.setTargets(second, 'city', '330100', [])).toBe(true)
    expect(store.setReady(first, '330101001000', ready)).toBe(false)
    expect(store.setFail(first, '330101001000', { code: 'X', message: 'x' })).toBe(false)
    expect(store.total).toBe(0)
  })
  it('整条流失败且尚无骨架时进入 error，有骨架时保留已展示标牌', () => {
    const store = useWeatherMarkersStore()
    const generation = store.begin('province', '330000')
    store.setStreamFail(generation, { code: 'WEATHER_MARKERS_STREAM_FAILED', message: '断连' })
    expect(store.phase).toBe('error')
    expect(store.errorMessage).toBe('断连')
  })
  it('clear 后 phase 为 closed 且 generation 递增', () => {
    const store = useWeatherMarkersStore()
    const generation = store.begin('county', '330101')
    store.setTargets(generation, 'county', '330101', targets)
    store.clear()
    expect(store.phase).toBe('closed')
    expect(store.total).toBe(0)
  })
})
