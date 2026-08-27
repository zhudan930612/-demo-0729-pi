import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const markerAddTo = vi.fn()
  const layerGroupClear = vi.fn()
  const layerGroupAdd = vi.fn()
  const createMarker = vi.fn((_latlng: unknown, _opts: { pane?: string } | undefined) => {
    const marker = { addTo: h.markerAddTo, on: vi.fn(), setZIndexOffset: vi.fn() }
    h.markerAddTo.mockReturnValue(marker)
    return marker
  })
  const createDivIcon = vi.fn(() => ({ iconSize: undefined }))
  // 最小 document stub（ensurePulseStyle/ensurePanes 会 document.createElement）
  const el = () => ({ appendChild: () => {}, setAttribute: () => {}, style: {} })
  globalThis.document = { createElement: () => el(), head: { appendChild: () => {} } } as never
  return { markerAddTo, layerGroupClear, layerGroupAdd, createMarker, createDivIcon }
})

vi.mock('leaflet', () => {
  const makeLayerGroup = () => {
    const group = { clearLayers: h.layerGroupClear, addTo: h.layerGroupAdd, remove: vi.fn() }
    h.layerGroupAdd.mockReturnValue(group)
    return group
  }
  return {
    default: {
      divIcon: h.createDivIcon,
      marker: h.createMarker,
      layerGroup: makeLayerGroup,
      DomEvent: { stopPropagation: vi.fn() },
    },
  }
})

import { createDisasterWarningLayerController } from './disasterWarningLayerController'

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

const v2 = { code: '330382101001', name: '甲村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.0, lat: 28.2, seatSource: 'seat' as const }
const v3 = { code: '330382101002', name: '乙村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.05, lat: 28.25, seatSource: 'seat' as const }
const v2b = { code: '330282101001', name: '丙村', cityCode: '330200', countyCode: '330282', townshipCode: '330282101000', lon: 121.4, lat: 29.9, seatSource: 'name' as const }
const low = { code: '330382101003', name: '低村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.1, lat: 28.3, seatSource: 'centroid' as const }

describe('createDisasterWarningLayerController · 村级预警标记（R3-6/R3-19/R3-20/R3-22）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('省/市级视角：按区县聚合为徽标，低风险不计（R3-19）', () => {
    const onBadgeClick = vi.fn()
    const ctl = createDisasterWarningLayerController({ onBadgeClick })
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
    const badgeMarkers = h.createMarker.mock.calls.filter((call) => String(call[1]?.pane).includes('Badge'))
    expect(badgeMarkers.length).toBe(2)
    expect(badgeMarkers.some((call) => String(call[1]?.pane).includes('Badge'))).toBe(true)
  })

  it('县/乡镇级视角：展开为村级脉冲，只画中/高（R3-6/R3-20）', () => {
    const ctl = createDisasterWarningLayerController()
    ctl.mount(fakeMap())
    ctl.render({
      level: 'county',
      entries: [
        { village: v2, level: 2 },
        { village: v3, level: 3 },
        { village: low, level: 1 },
      ],
    })
    const pulseMarkers = h.createMarker.mock.calls.filter((call) => String(call[1]?.pane).includes('Pulse'))
    expect(pulseMarkers.length).toBe(2) // 中 + 高，低不上图
  })

  it('村级视角：显示本村及同乡镇预警村（R3-22）——由 mode 过滤后传入，控制器原样渲染', () => {
    const ctl = createDisasterWarningLayerController()
    ctl.mount(fakeMap())
    ctl.render({
      level: 'village',
      entries: [
        { village: v2, level: 2 },
        { village: v3, level: 3 },
      ],
    })
    const pulseMarkers = h.createMarker.mock.calls.filter((call) => String(call[1]?.pane).includes('Pulse'))
    expect(pulseMarkers.length).toBe(2)
  })

  it('clear/destroy 清理图层', () => {
    const ctl = createDisasterWarningLayerController()
    ctl.mount(fakeMap())
    ctl.render({ level: 'province', entries: [], countySeats: new Map() })
    ctl.clear()
    ctl.destroy()
    expect(h.layerGroupClear).toHaveBeenCalled()
  })
})
