import { describe, expect, it, vi } from 'vitest'
vi.mock('leaflet', () => ({ default: {} }))
import { buildWeatherMarkerHtml, limitCityMarkersByZoom, CITY_MIN_ZOOM_FOR_ALL } from './weatherMarkerLayerController'
import { WEATHER_PANES } from './weatherLayerController'
import type { WeatherMarkerItem } from '../stores/weatherMarkers'

const item = (overrides: Partial<WeatherMarkerItem> = {}): WeatherMarkerItem => ({
  code: '330101001000',
  level: 'township',
  name: '示例乡',
  location: { lat: 30, lon: 120 },
  state: { phase: 'loading' },
  ...overrides,
})

describe('weather marker layer', () => {
  it('骨架态显示名称与 --', () => {
    const html = buildWeatherMarkerHtml(item())
    expect(html).toContain('示例乡')
    expect(html).toContain('>--<')
    expect(html).toContain('aria-label="示例乡 天气加载中"')
  })
  it('成功态显示天气现象与最低/最高整数温度', () => {
    const html = buildWeatherMarkerHtml(item({ state: { phase: 'ready', summary: { condition: { code: '100', text: '晴' }, temperature: { value: 26.4, unit: '°C' }, high: { value: 32.6, unit: '°C' }, low: { value: 23.5, unit: '°C' }, fetchedAt: 'x' } } }))
    expect(html).toContain('qi-100')
    expect(html).toContain('24/33°C')
    expect(html).toContain('最高33')
    expect(html).toContain('最低24')
  })
  it('逐小时缺失时回退当前温度；失败态保留可点按钮', () => {
    const fallback = buildWeatherMarkerHtml(item({ state: { phase: 'ready', summary: { condition: { code: null, text: null }, temperature: { value: 26, unit: '°C' }, high: null, low: null, fetchedAt: 'x' } } }))
    expect(fallback).toContain('qi-999')
    expect(fallback).toContain('26°C')
    const failed = buildWeatherMarkerHtml(item({ state: { phase: 'error', error: { code: 'X', message: '失败' } } }))
    expect(failed).toContain('加载失败')
  })
  it('标牌 pane 与预警共用注记之上的层级', () => {
    expect(WEATHER_PANES.marker.zIndex).toBeGreaterThan(450)
  })
  it('省级标牌按缩放分层：<6 仅杭州，6~7 固定 5 市，≥7 全部', () => {
    const cities: WeatherMarkerItem[] = ['330100', '330200', '330300', '330400', '330500', '330600', '330700', '330800', '330900', '331000', '331100'].map((code) => item({ code, name: `市${code}`, level: 'city' }))
    const townships: WeatherMarkerItem[] = [item({ code: '330101001000', level: 'township', name: '示例乡' })]
    const mixed = [...cities, ...townships]
    expect(limitCityMarkersByZoom(mixed, 5.9).map((entry) => entry.code)).toEqual(['330100', '330101001000'])
    expect(limitCityMarkersByZoom(mixed, 6.0).map((entry) => entry.code)).toEqual(['330700', '330200', '330100', '331000', '330500', '330101001000'])
    expect(limitCityMarkersByZoom(mixed, 6.9).map((entry) => entry.code)).toEqual(['330700', '330200', '330100', '331000', '330500', '330101001000'])
    expect(limitCityMarkersByZoom(mixed, CITY_MIN_ZOOM_FOR_ALL).map((entry) => entry.code)).toHaveLength(12)
    expect(limitCityMarkersByZoom(townships, 3).map((entry) => entry.code)).toEqual(['330101001000'])
  })
})
