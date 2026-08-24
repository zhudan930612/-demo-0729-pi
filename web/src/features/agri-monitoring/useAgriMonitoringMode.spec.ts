import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Ref } from 'vue'

vi.mock('leaflet', () => ({
  default: { circleMarker: vi.fn(() => ({ addTo: vi.fn(), remove: vi.fn() })) },
}))
vi.mock('../../map/agriMonitoringLayerController', () => ({
  createAgriLayerController: vi.fn(() => ({
    mount: vi.fn(), setRaster: vi.fn(), setDate: vi.fn(), setOpacity: vi.fn(),
    setVisible: vi.fn(), redraw: vi.fn(), destroy: vi.fn(),
  })),
}))
vi.mock('../../api/data', () => ({ fetchJSON: vi.fn() }))

import { useAgriMonitoringMode } from './useAgriMonitoringMode'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'

vi.mock('./agriMonitoringData', () => {
  const raster = { dates: ['2026-06-01', '2026-07-27'], grid: [{ lat: 30, lon: 120, values: [60, 65] }] }
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
    store.receive(store.generation, { raster: { dates: ['2026-06-01'], grid: [] } })
    await mode.exit()
    expect(store.isOpen).toBe(false)
    expect(store.phase).toBe('closed')
  })
})
