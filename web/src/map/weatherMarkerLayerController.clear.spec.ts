import { describe, expect, it, vi } from 'vitest'
import type L from 'leaflet'
import type { WeatherMarkerItem } from '../stores/weatherMarkers'

const mocks = vi.hoisted(() => ({
  marker: vi.fn(() => ({
    setLatLng: vi.fn(),
    setIcon: vi.fn(),
    remove: vi.fn(),
    addTo: vi.fn(),
    on: vi.fn(),
    getElement: vi.fn(() => null),
    getLatLng: vi.fn(() => ({ lat: 30, lng: 120 })),
  })),
}))

vi.mock('leaflet', () => ({
  default: {
    marker: mocks.marker,
    divIcon: vi.fn(() => ({})),
    latLng: vi.fn((lat: number, lng: number) => ({ lat, lng })),
    point: vi.fn((x: number, y: number) => ({ x, y })),
    layerGroup: vi.fn(() => {
      const group = { addTo: vi.fn(), clearLayers: vi.fn(), addLayer: vi.fn(), removeLayer: vi.fn() }
      group.addTo = vi.fn(() => group)
      return group
    }),
    DomEvent: { stopPropagation: vi.fn() },
  },
}))

import { createWeatherMarkerLayerController } from './weatherMarkerLayerController'

const item = (code: string): WeatherMarkerItem => ({
  code,
  level: 'city',
  name: `市${code}`,
  location: { lat: 30, lon: 120 },
  state: { phase: 'loading' },
})

function createMockMap() {
  const handlers: Record<string, () => void> = {}
  return {
    map: {
      getPane: vi.fn(() => ({ style: {} })),
      createPane: vi.fn(() => ({ style: {} })),
      on: vi.fn((event: string, fn: () => void) => { handlers[event] = fn }),
      off: vi.fn(),
      getZoom: vi.fn(() => 7),
      latLngToContainerPoint: vi.fn(() => ({ x: 0, y: 0 })),
      containerPointToLatLng: vi.fn(() => ({ lat: 30, lng: 120 })),
    } as unknown as L.Map,
    fire: (event: string) => handlers[event]?.(),
  }
}

describe('weather marker layer clear', () => {
  it('clear 后 zoom 事件不会把已退出的标牌重新渲染回地图', () => {
    const { map, fire } = createMockMap()
    const controller = createWeatherMarkerLayerController(map, {})
    controller.render([item('330100'), item('330200')], null)
    const createdAfterRender = mocks.marker.mock.calls.length
    expect(createdAfterRender).toBe(2)

    controller.clear()
    fire('zoom') // 模拟进入台风等场景下的缩放：zoom 处理器会用残留快照重渲染
    expect(mocks.marker.mock.calls.length).toBe(createdAfterRender)

    fire('move')
    expect(mocks.marker.mock.calls.length).toBe(createdAfterRender)
  })
})
