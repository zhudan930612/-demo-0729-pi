import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const layerGroupClear = vi.fn()
  const layerGroupRemove = vi.fn()
  const createMarker = vi.fn((_latlng: unknown, _opts: { pane?: string } | undefined) => {
    const marker = { addTo: () => marker, on: vi.fn(), setZIndexOffset: vi.fn() }
    return marker
  })
  const createGeoJSON = vi.fn((_geojson: unknown, _opts: unknown) => {
    const layer = { addTo: () => layer, on: vi.fn(), remove: vi.fn() }
    return layer
  })
  const makeLayerGroup = () => {
    const group = { clearLayers: h.layerGroupClear, addTo: () => group, remove: h.layerGroupRemove }
    return group
  }
  // 最小 document stub（ensureBadgeStyle/ensurePanes 会 document.createElement）
  const el = () => ({ appendChild: () => {}, setAttribute: () => {}, style: {} })
  globalThis.document = { createElement: () => el(), head: { appendChild: () => {} } } as never
  return { layerGroupClear, layerGroupRemove, createMarker, createGeoJSON, makeLayerGroup }
})

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn(() => ({})),
    marker: h.createMarker,
    geoJSON: h.createGeoJSON,
    layerGroup: h.makeLayerGroup,
    DomEvent: { stopPropagation: vi.fn() },
  },
}))
vi.mock('../api/data', () => ({ fetchJSON: vi.fn() }))

import { fetchJSON } from '../api/data'
import { createDisasterWarningLayerController } from './disasterWarningLayerController'
import { WARNING_LEVEL_COLOR } from '../features/disaster-warning/disasterWarningSelectors'

const mockFetch = vi.mocked(fetchJSON)
const markerMock = h.createMarker
const geoJsonMock = h.createGeoJSON

function fakeMap() {
  const panes = new Map<string, HTMLElement>()
  return {
    createPane: vi.fn((name: string) => {
      const el = document.createElement('div')
      panes.set(name, el)
      return el
    }),
    getPane: vi.fn((name: string) => panes.get(name)),
    latLngToContainerPoint: vi.fn(() => ({ x: 0, y: 0 })),
  } as never
}

function townshipFC() {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { code: '330382101001', name: '甲村' }, geometry: { type: 'Polygon', coordinates: [[[121, 28.2], [121.05, 28.2], [121.05, 28.25], [121, 28.2]]] } },
      { type: 'Feature', properties: { code: '330382101002', name: '乙村' }, geometry: { type: 'Polygon', coordinates: [[[121.05, 28.2], [121.1, 28.2], [121.1, 28.25], [121.05, 28.2]]] } },
    ],
  }
}

const v2 = { code: '330382101001', name: '甲村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.0, lat: 28.2, seatSource: 'seat' as const }
const v3 = { code: '330382101002', name: '乙村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.05, lat: 28.25, seatSource: 'seat' as const }
const v2b = { code: '330282101001', name: '丙村', cityCode: '330200', countyCode: '330282', townshipCode: '330282101000', lon: 121.4, lat: 29.9, seatSource: 'name' as const }
const low = { code: '330382101003', name: '低村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.1, lat: 28.3, seatSource: 'centroid' as const }

describe('createDisasterWarningLayerController · 村级预警标记（R3-6/R3-19/R3-20/R3-22）', () => {
  beforeEach(() => { vi.clearAllMocks(); mockFetch.mockReset() })

  it('省/市级视角：按区县聚合为徽标，低风险不计（R3-19）', () => {
    const ctl = createDisasterWarningLayerController({})
    ctl.mount(fakeMap())
    ctl.render({
      level: 'province',
      entries: [
        { village: v2, level: 2 },
        { village: v3, level: 3 },
        { village: v2b, level: 2 },
        { village: low, level: 1 }, // 低风险不上图
      ],
      countySeats: new Map([['330382', [121.03, 28.21]], ['330282', [121.4, 29.9]]]),
    })
    const badgeMarkers = markerMock.mock.calls.filter((call) => String(call[1]?.pane).includes('Badge'))
    expect(badgeMarkers.length).toBe(2) // 330382（中+高）、330282（中）；低风险村不单独上图
    expect(geoJsonMock.mock.calls.length).toBe(0) // 省市视角不画村边界
  })

  it('县/乡镇级：按预警等级给村边界面上色，低风险不上图（R3-6/R3-20）', async () => {
    mockFetch.mockResolvedValue(townshipFC() as never)
    const ctl = createDisasterWarningLayerController({})
    ctl.mount(fakeMap())
    ctl.render({
      level: 'county',
      entries: [
        { village: v2, level: 2 }, // 中
        { village: v3, level: 3 }, // 高
        { village: low, level: 1 }, // 低风险不上图
      ],
    })
    await vi.waitFor(() => expect(geoJsonMock.mock.calls.length).toBeGreaterThan(0))
    expect(mockFetch).toHaveBeenCalledWith('/data/villages/330382101000.geojson')
    // 甲村(中) + 乙村(高) 共 2 条；低风险村不画
    expect(geoJsonMock.mock.calls.length).toBe(2)
    const byCode = (geoJsonMock.mock.calls as Array<[{ properties: { code: string } }, { style: Record<string, unknown>; pane: string }]>)
      .map(([feature, opts]) => ({ code: feature.properties.code, color: opts.style.color, pane: opts.pane }))
    expect(byCode.find((x) => x.code === '330382101001')?.color).toBe(WARNING_LEVEL_COLOR[2])
    expect(byCode.find((x) => x.code === '330382101002')?.color).toBe(WARNING_LEVEL_COLOR[3])
    expect(byCode.every((x) => x.pane === 'disasterWarningBoundaryPane')).toBe(true)
  })

  it('村级视角：本村及同乡镇预警村边界一并高亮（R3-22）', async () => {
    mockFetch.mockResolvedValue(townshipFC() as never)
    const ctl = createDisasterWarningLayerController({})
    ctl.mount(fakeMap())
    ctl.render({ level: 'village', entries: [{ village: v2, level: 2 }, { village: v3, level: 3 }] })
    await vi.waitFor(() => expect(geoJsonMock.mock.calls.length).toBeGreaterThan(0))
    expect(geoJsonMock.mock.calls.length).toBe(2) // 本村 + 同乡镇预警村
  })

  it('村界缺失：跳过不绘制（不崩溃）', async () => {
    mockFetch.mockRejectedValue(new Error('404'))
    const ctl = createDisasterWarningLayerController({})
    ctl.mount(fakeMap())
    ctl.render({ level: 'township', entries: [{ village: v2, level: 3 }] })
    await new Promise((r) => setTimeout(r, 0))
    expect(geoJsonMock.mock.calls.length).toBe(0)
  })

  it('clear/destroy 清理图层与村界缓存', () => {
    const ctl = createDisasterWarningLayerController()
    ctl.mount(fakeMap())
    ctl.render({ level: 'province', entries: [], countySeats: new Map() })
    ctl.clear()
    ctl.destroy()
    expect(h.layerGroupClear).toHaveBeenCalled()
    expect(h.layerGroupRemove).toHaveBeenCalled()
  })
})
