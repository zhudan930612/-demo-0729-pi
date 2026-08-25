import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Ref } from 'vue'

vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn(() => ({})),
    marker: vi.fn(() => ({ addTo: vi.fn(), remove: vi.fn() })),
  },
}))
vi.mock('../../map/agriMonitoringLayerController', () => ({
  createAgriLayerController: vi.fn(() => ({
    mount: vi.fn(), setRaster: vi.fn(), setDate: vi.fn(), setOpacity: vi.fn(),
    setVisible: vi.fn(), redraw: vi.fn(), destroy: vi.fn(),
  })),
}))
vi.mock('../../api/data', () => ({ fetchJSON: vi.fn() }))

import { fetchJSON } from '../../api/data'
import { useAgriMonitoringMode } from './useAgriMonitoringMode'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'

const mockFetch = vi.mocked(fetchJSON)
vi.mock('./agriMonitoringData', () => {
  const raster = { originLon: 120, originLat: 30, stepLon: 0.01, stepLat: 0.01, cols: 1, rows: 1, dates: ['2026-06-01', '2026-07-27'], layers: [[60], [65]] }
  return {
    loadAgriRaster: vi.fn(async () => raster),
    loadAgriVillages: vi.fn(async () => []),
    loadAgriLevels: vi.fn(async () => ({ byCode: {} })),
    loadAgriTasks: vi.fn(async () => []),
    loadAgriPolicyGrowth: vi.fn(async () => []),
  }
})

function makeCtx(overrides: Partial<Parameters<typeof useAgriMonitoringMode>[0]> = {}) {
  const exits = {
    typhoon: vi.fn(), weather: vi.fn(), nationalAlarms: vi.fn(), precipitation: vi.fn(), lodging: vi.fn(),
  }
  const ctx = {
    store: { current: { level: 'province', code: '330000', name: '浙江省' }, navigateTo: vi.fn(), resetToProvince: vi.fn(async () => true), back: vi.fn() } as never,
    disasterActive: { value: false } as Ref<boolean>,
    anyWeatherActive: vi.fn(() => false),
    hasUnsavedParcelWork: vi.fn(() => false),
    exits,
    resetToProvince: vi.fn(async () => true),
    render: vi.fn(async () => {}),
    showNotice: vi.fn(),
    ...overrides,
  }
  return { ctx, exits }
}

describe('useAgriMonitoringMode · 模式互斥', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('R7-1 进入时退出降水/倒伏评估（默认无台风/天气）', async () => {
    const { ctx, exits } = makeCtx()
    const mode = useAgriMonitoringMode(ctx)
    await mode.enter()
    expect(exits.precipitation).toHaveBeenCalled()
    expect(exits.lodging).toHaveBeenCalled()
    expect(exits.typhoon).not.toHaveBeenCalled()
    expect(exits.weather).not.toHaveBeenCalled()
  })

  it('R7-1 若处于天气/台风模式，进入时一并退出', async () => {
    const { ctx, exits } = makeCtx({
      anyWeatherActive: vi.fn(() => true),
      disasterActive: { value: true } as Ref<boolean>,
    })
    const mode = useAgriMonitoringMode(ctx)
    await mode.enter()
    expect(exits.weather).toHaveBeenCalled()
    expect(exits.nationalAlarms).toHaveBeenCalled()
    expect(exits.typhoon).toHaveBeenCalled()
  })

  it('进入时打开 store 并重渲染（省级视角）', async () => {
    const store = useAgriMonitoringStore()
    const { ctx } = makeCtx()
    const mode = useAgriMonitoringMode(ctx)
    await mode.enter()
    expect(store.isOpen).toBe(true)
    expect(ctx.resetToProvince).toHaveBeenCalled()
    expect(ctx.render).toHaveBeenCalled()
  })

  it('R7-2 退出时清除农情状态并销毁图层', async () => {
    const store = useAgriMonitoringStore()
    const { ctx } = makeCtx()
    const mode = useAgriMonitoringMode(ctx)
    await mode.enter()
    store.receive(store.generation, { raster: { originLon: 120, originLat: 30, stepLon: 0.01, stepLat: 0.01, cols: 1, rows: 1, dates: ['2026-06-01'], layers: [[]] } })
    await mode.exit()
    expect(store.isOpen).toBe(false)
    expect(store.phase).toBe('closed')
  })

  it('下钻到村：补齐省/市/县/镇/村完整路径（乡镇层不丢）', async () => {
    const boundaries: Record<string, unknown> = {
      '/data/boundary/city/330000.geojson': { features: [{ properties: { code: '330600', name: '绍兴市' }, geometry: { type: 'Polygon', coordinates: [] } }] },
      '/data/boundary/county/330600.geojson': { features: [{ properties: { code: '330604', name: '上虞区' }, geometry: { type: 'Polygon', coordinates: [] } }] },
      '/data/boundary/township/330604.geojson': { features: [{ properties: { code: '330604104000', name: '章镇镇' }, geometry: { type: 'Polygon', coordinates: [] } }] },
      '/data/villages/330604104000.geojson': { features: [{ properties: { code: '330604102014', name: '龙江村' }, geometry: { type: 'Polygon', coordinates: [] } }] },
    }
    mockFetch.mockImplementation(async (url: string) => (boundaries as Record<string, never>)[url as never] as never)
    const navigateTo = vi.fn(async (_crumbs: unknown) => true)
    const { ctx } = makeCtx()
    // 预置村（drillToVillage 依赖 store.villages 找村）
    const store = useAgriMonitoringStore()
    store.open()
    store.receive(store.generation, { villages: [{ code: '330604102014', name: '龙江村', centroid: { lon: 120, lat: 30, name: '龙江村' }, insuredAreaMu: 10, householdCount: 1, policyCount: 1, levels: { veryPoor: 0, poor: 0, normal: 1, good: 0, excellent: 0 }, anomalyRatio: 0, isAnomaly: false, countyCode: '330604', cityCode: '330600', townshipCode: '330604104000', data: true }] })
    ctx.store = { current: { level: 'province', code: '330000', name: '浙江省' }, navigateTo } as never
    const mode = useAgriMonitoringMode(ctx)
    expect(store.villages).toHaveLength(1)
    await mode.drillToVillage('330604102014')
    expect(navigateTo).toHaveBeenCalledTimes(1)
    const crumbs = (navigateTo.mock.calls[0]![0] as unknown) as Array<{ level: string; name: string }>
    expect(crumbs.map((c) => c.name)).toEqual(['浙江省', '绍兴市', '上虞区', '章镇镇', '龙江村'])
  })

  it('定位到地图：地图不空时不抛错（R5-4 marker 创建链路）', async () => {
    const { ctx } = makeCtx()
    const mode = useAgriMonitoringMode(ctx)
    mode.init({ flyTo: vi.fn(), getZoom: () => 10 } as never)
    expect(() => mode.locateTask({ lon: 120, lat: 30, name: 'x' })).not.toThrow()
  })
})
