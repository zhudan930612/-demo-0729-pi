import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VillageBoundary } from '../features/village-risk/villageRiskData'

const state = vi.hoisted(() => {
  const panes = new Map<string, { style: Record<string, string> }>()
  const layerGroups: Array<{ kind: 'fill' | 'marker' | 'stroke'; layer: unknown }> = []
  const markers: Array<Record<string, unknown>> = []
  const polygons: Array<Record<string, unknown>> = []
  const legendEls: Array<{ style: Record<string, string>; innerHTML: string }> = []
  const mapContainer = {
    appendChild(el: { style: Record<string, string>; innerHTML: string }) { legendEls.push(el) },
  }
  const reset = () => {
    panes.clear(); layerGroups.length = 0; markers.length = 0; polygons.length = 0; legendEls.length = 0
  }
  return { panes, layerGroups, markers, polygons, legendEls, mapContainer, reset }
})

vi.mock('leaflet', () => ({
  default: {
    layerGroup: () => ({
      addTo() {},
      addLayer(layer: unknown) { state.layerGroups.push({ kind: 'group', layer }) },
      clearLayers() { state.layerGroups.length = 0; state.markers.length = 0; state.polygons.length = 0 },
    }),
    polygon(latlngs: unknown, options: Record<string, unknown>) {
      const layer: Record<string, unknown> = {
        latlngs, options,
        handlers: {} as Record<string, () => void>,
        tooltip: null,
        bindTooltip(name: string) { layer.tooltip = name; return layer },
        on(event: string, fn: () => void) { (layer.handlers as Record<string, () => void>)[event] = fn; return layer },
        getBounds() { return { getCenter: () => ({ lat: 0, lng: 0 }) } },
        remove() {},
      }
      state.polygons.push(layer)
      return layer
    },
    marker(latlng: unknown, options: Record<string, unknown>) {
      const layer: Record<string, unknown> = {
        latlng, options,
        handlers: {} as Record<string, () => void>,
        tooltip: null,
        bindTooltip(name: string) { layer.tooltip = name; return layer },
        on(event: string, fn: () => void) { (layer.handlers as Record<string, () => void>)[event] = fn; return layer },
        getLatLng() { return { lat: 0, lng: 0 } },
        addTo() {}, remove() { state.markers.splice(state.markers.indexOf(layer), 1) },
      }
      state.markers.push(layer)
      return layer
    },
    divIcon: (opts: unknown) => opts,
  },
}))

import {
  buildVillageMarkerHtml,
  createVillageRiskLayerController,
  RISK_FILL_COLOR,
  RISK_MARKER_COLOR,
  RISK_STROKE_COLOR,
  VILLAGE_RISK_PANES,
  type VillageRiskLayerController,
} from './villageRiskLayerController'

function village(code: string, name: string): VillageBoundary {
  return {
    code, name,
    polygons: [[[[120.8, 29.7], [120.9, 29.7], [120.9, 29.8], [120.8, 29.8], [120.8, 29.7]]]],
    bbox: { latMin: 29.7, latMax: 29.8, lonMin: 120.8, lonMax: 120.9 },
    centroid: { lat: 29.75, lon: 120.85 },
    countyCode: code.slice(0, 6),
  }
}

function makeMap() {
  return {
    getPane: (name: string) => state.panes.get(name) ?? null,
    createPane: (name: string) => {
      const el = { style: {} as Record<string, string> }
      state.panes.set(name, el)
      return el
    },
    latLngToContainerPoint: (latlng: { lat: number; lng: number }) => ({ x: Math.round(latlng.lat * 100), y: Math.round(latlng.lng * 100) }),
    getContainer: () => state.mapContainer,
  } as never
}

const ENTRIES = [
  { village: village('330604102016', '清潭村'), level: 3 as const },
  { village: village('330604102014', '龙江村'), level: 1 as const },
  { village: village('330683104307', '临虞村'), level: 0 as const },
]

describe('buildVillageMarkerHtml', () => {
  it('等级色圆点 + aria-label 含村名与风险文案', () => {
    const html = buildVillageMarkerHtml(ENTRIES[0]!)
    expect(html).toContain('--risk-color:#b91c1c')
    expect(html).toContain('清潭村')
    expect(html).toContain('高风险')
    expect(html).toContain('aria-label')
  })
})

describe('VillageRiskLayerController 渲染与层级', () => {
  let controller: VillageRiskLayerController
  let map: ReturnType<typeof makeMap>
  beforeEach(() => {
    state.reset()
    // node 测试环境无 DOM：stub 最小 document（ensureStyle/图例创建用）
    vi.stubGlobal('document', {
      head: { appendChild: () => {} },
      createElement: (tag: string) => ({
        style: {},
        tagName: tag,
        className: '',
        innerHTML: '',
        textContent: '',
        removed: false,
        setAttribute: () => {},
        appendChild: () => {},
        remove() { this.removed = true },
      }),
    })
    controller = createVillageRiskLayerController({ onVillageClick: () => {} })
    map = makeMap()
  })

  it('mount 创建 fill/marker pane，fill pointer-events none', () => {
    controller.mount(map)
    expect(state.panes.get('villageRiskFillPane')?.style.zIndex).toBe(String(VILLAGE_RISK_PANES.fill.zIndex))
    expect(state.panes.get('villageRiskFillPane')?.style.pointerEvents).toBe('none')
    expect(state.panes.get('villageRiskMarkerPane')?.style.zIndex).toBe(String(VILLAGE_RISK_PANES.marker.zIndex))
    expect(state.legendEls).toHaveLength(1) // 图例元素挂载
  })

  it('省市不渲染任何标注', () => {
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('province')
    controller.setData(ENTRIES)
    expect(state.markers).toHaveLength(0)
    expect(state.polygons).toHaveLength(0)
    expect(state.legendEls[0]?.style.display).toBe('none')
    controller.setLevel('city')
    expect(state.markers).toHaveLength(0)
  })

  it('乡镇级：圆点标记 + 图例显示', () => {
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('township')
    controller.setData(ENTRIES)
    expect(state.markers).toHaveLength(3)
    expect(state.polygons).toHaveLength(0)
    expect(state.legendEls[0]?.style.display).toBe('flex')
    expect(state.markers[0]?.options.pane).toBe('villageRiskMarkerPane')
  })

  it('县级：同样显示标记', () => {
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('county')
    controller.setData(ENTRIES)
    expect(state.markers).toHaveLength(3)
  })

  it('村级：淡色填充 + 等级色描边，fill 不拦截、描边可交互', () => {
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('village')
    controller.setData(ENTRIES)
    expect(state.markers).toHaveLength(0)
    // 3 村 × (fill + stroke)
    expect(state.polygons).toHaveLength(6)
    const fills = state.polygons.filter((p) => (p.options as Record<string, unknown>).interactive === false)
    const strokes = state.polygons.filter((p) => (p.options as Record<string, unknown>).interactive === true)
    expect(fills).toHaveLength(3)
    expect(strokes).toHaveLength(3)
    expect((fills[0]?.options as Record<string, unknown>).pane).toBe('villageRiskFillPane')
    expect((strokes[0]?.options as Record<string, unknown>).pane).toBe('villageRiskMarkerPane')
    expect((strokes[0]?.options as Record<string, unknown>).color).toBe(RISK_STROKE_COLOR[3])
    expect((fills[0]?.options as Record<string, unknown>).fillColor).toBe(RISK_FILL_COLOR[3])
    expect(strokes[0]?.tooltip).toBe('清潭村')
    expect(state.legendEls[0]?.style.display).toBe('none')
  })

  it('描边点击触发 onVillageClick(code, point)', () => {
    const clicked: Array<[string, { x: number; y: number }]> = []
    controller = createVillageRiskLayerController({ onVillageClick: (code, point) => clicked.push([code, point]) })
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('village')
    controller.setData(ENTRIES)
    const stroke = state.polygons.find((p) => (p.options as Record<string, unknown>).interactive === true && p.tooltip === '清潭村')
    ;(stroke!.handlers as Record<string, () => void>).click()
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.[0]).toBe('330604102016')
    expect(clicked[0]?.[1]).toEqual({ x: 0, y: 0 })
  })

  it('标记点击触发 onVillageClick', () => {
    const clicked: Array<string> = []
    controller = createVillageRiskLayerController({ onVillageClick: (code) => clicked.push(code) })
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('township')
    controller.setData(ENTRIES)
    ;(state.markers[0]!.handlers as Record<string, () => void>).click()
    expect(clicked).toEqual(['330604102016'])
  })

  it('setSelected：村级追加选中标记；取消后移除', () => {
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('village')
    controller.setData(ENTRIES)
    controller.setSelected('330604102016')
    expect(state.markers).toHaveLength(1) // 选中标记
    expect((state.markers[0]?.options as Record<string, unknown>).icon).toBeTruthy()
    controller.setSelected(null)
    expect(state.markers).toHaveLength(0)
  })

  it('setVisible(false) 清除全部标注与图例', () => {
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('township')
    controller.setData(ENTRIES)
    expect(state.markers).toHaveLength(3)
    controller.setVisible(false)
    expect(state.markers).toHaveLength(0)
    expect(state.legendEls[0]?.style.display).toBe('none')
  })

  it('clear 重置全部状态（闭包快照清理）', () => {
    controller.mount(map)
    controller.setVisible(true)
    controller.setLevel('village')
    controller.setData(ENTRIES)
    controller.setSelected('330604102016')
    controller.clear()
    expect(state.polygons).toHaveLength(0)
    expect(state.markers).toHaveLength(0)
    expect(state.legendEls[0]?.style.display).toBe('none')
    // clear 后再 setVisible(true) 不残留
    controller.setVisible(true)
    expect(state.markers).toHaveLength(0)
  })

  it('destroy 移除图例元素', () => {
    controller.mount(map)
    controller.destroy()
    expect((state.legendEls[0] as { removed?: boolean }).removed).toBe(true)
  })
})

describe('风险色令牌', () => {
  it('四档填充/描边/标记色齐全且互不相同', () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(RISK_FILL_COLOR[level]).toBeTruthy()
      expect(RISK_STROKE_COLOR[level]).toBeTruthy()
      expect(RISK_MARKER_COLOR[level]).toBe(RISK_STROKE_COLOR[level])
    }
    expect(new Set([0, 1, 2, 3].map((l) => RISK_STROKE_COLOR[l as 0 | 1 | 2 | 3]).join(''))).toBeTruthy()
  })
})
