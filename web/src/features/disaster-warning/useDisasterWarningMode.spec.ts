import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Ref } from 'vue'

vi.mock('leaflet', () => {
  class FakeGridLayer {
    static extend?: unknown
    options: Record<string, unknown>
    constructor(options: Record<string, unknown> | undefined = {}) { this.options = { ...options } }
    addTo() { return this }
    remove() {}
    getContainer() { return { style: {} } }
    redraw() {}
  }
  return {
    default: {
      divIcon: vi.fn(() => ({})),
      marker: vi.fn(() => ({ addTo: vi.fn(), remove: vi.fn() })),
      GridLayer: FakeGridLayer,
      layerGroup: () => ({ addTo: vi.fn(), remove: vi.fn(), clearLayers: vi.fn() }),
      latLngBounds: () => ({ isValid: () => true }),
      DomEvent: { stopPropagation: vi.fn() },
    },
  }
})
// node 环境无 document：disasterWarningLayerController.ensurePulseStyle 需要（挂载时注入脉冲动效样式）
Object.defineProperty(globalThis, 'document', {
  value: { createElement: () => ({ set textContent(_v: string) {}, style: {}, setAttribute: () => {} }), head: { appendChild: () => {} } },
  writable: true,
})
vi.mock('../../api/data', () => ({ fetchJSON: vi.fn() }))

import { fetchJSON } from '../../api/data'
import { useDisasterWarningMode } from './useDisasterWarningMode'
import { useDisasterWarningStore } from '../../stores/disasterWarning'

const mockFetch = vi.mocked(fetchJSON)

const track = {
  code: 200, no1: '3257931', no2: '2609', namecn: '巴威', type: 'stop',
  datas: [{ time_ymdh: '2026-07-09 00:00:00', lat: 28.1, lon: 121.2 }],
}
const precip = {
  schemaVersion: 1, model: 'ERA5', aggregateFrom: '2026-07-09 00:00:00',
  nodeTimes: ['2026-07-09 00:00:00'], grid: [{ lat: 28.084, lon: 121.220, cum: [0.0] }],
}
const warnings = {
  schemaVersion: 1, thresholds: { low: 130, mid: 160, high: 185 }, hysteresisNodes: 2,
  nodeTimes: ['2026-07-09 00:00:00'], villages: [], nodes: [{ i: 0, w: [] }],
}
const underwriting = {
  schemaVersion: 1, seed: 'x', sumInsuredPerMu: 1250, targetTotalMu: 100000,
  villages: [{ code: '330382101001', name: '示例村', insuredAreaMu: 100, householdCount: 10, sumInsuredYuan: 125000, source: 'mock' as const }],
}
const riskModel = {
  schemaVersion: 1,
  riskLevelFromCumRainMm: [{ max: 50, level: 0 as const, name: '无', coefficient: 0.2 }],
  lossRateByWarningLevel: [{ level: 1 as const, name: '低', lossRate: 0.03 }],
  formula: 'x',
}

function makeCtx(overrides: Partial<Parameters<typeof useDisasterWarningMode>[0]> = {}) {
  const exits = {
    typhoon: vi.fn(), weather: vi.fn(), nationalAlarms: vi.fn(), precipitation: vi.fn(), lodging: vi.fn(), agri: vi.fn(),
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

describe('useDisasterWarningMode · 模式互斥与进入/退出（R1-2/R1-4）', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('R1-4 进入时退出其他模式（天气/台风/降水/倒伏评估/农情监测）', async () => {
    const { ctx, exits } = makeCtx({ anyWeatherActive: vi.fn(() => true), disasterActive: { value: true } as Ref<boolean> })
    const mode = useDisasterWarningMode(ctx)
    await mode.enter()
    expect(exits.weather).toHaveBeenCalled()
    expect(exits.nationalAlarms).toHaveBeenCalled()
    expect(exits.typhoon).toHaveBeenCalled()
    expect(exits.precipitation).toHaveBeenCalled()
    expect(exits.lodging).toHaveBeenCalled()
    expect(exits.agri).toHaveBeenCalled()
  })

  it('R1-2/R1-4 进入：打开 store、切省级视角、加载数据；退出：关闭 store', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return track
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnings
      if (url.endsWith('/underwriting.json')) return underwriting
      if (url.endsWith('/risk-model.json')) return riskModel
      throw new Error(`${url} -> 404`)
    })
    const { ctx } = makeCtx()
    const mode = useDisasterWarningMode(ctx)
    const store = useDisasterWarningStore()
    await mode.enter()
    expect(store.isOpen).toBe(true)
    expect(ctx.resetToProvince).toHaveBeenCalled()
    await vi.waitFor(() => expect(store.phase).toBe('ready'))
    expect(store.track?.namecn).toBe('巴威')
    mode.exit()
    expect(store.isOpen).toBe(false)
    expect(store.track).toBeNull()
  })

  it('R1-4 有未保存地块工作时禁止进入', async () => {
    const { ctx } = makeCtx({ hasUnsavedParcelWork: vi.fn(() => true) })
    const mode = useDisasterWarningMode(ctx)
    const store = useDisasterWarningStore()
    await mode.enter()
    expect(store.isOpen).toBe(false)
    expect(ctx.resetToProvince).not.toHaveBeenCalled()
  })

  it('R1-4 退出时若无其他模式激活则恢复省级视角', async () => {
    mockFetch.mockRejectedValue(new Error('404'))
    const { ctx } = makeCtx()
    const mode = useDisasterWarningMode(ctx)
    await mode.enter()
    mode.exit()
    expect(ctx.resetToProvince).toHaveBeenCalledTimes(2) // enter + exit 各一次
    expect(ctx.render).toHaveBeenCalled()
  })

  it('R2-18 数据加载失败 → error 态 + 错误提示（降级）', async () => {
    mockFetch.mockRejectedValue(new Error('404'))
    const { ctx } = makeCtx()
    const mode = useDisasterWarningMode(ctx)
    const store = useDisasterWarningStore()
    await mode.enter()
    await vi.waitFor(() => expect(store.phase).toBe('error'))
    expect(store.errorMessage).toBe('404')
    expect(ctx.showNotice).toHaveBeenCalledWith(expect.stringContaining('降级'), true)
  })
})

describe('useDisasterWarningMode · tab 切换（R1-5）', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('默认灾损预估，可切换到预警监测/任务列表', async () => {
    const { ctx } = makeCtx()
    const mode = useDisasterWarningMode(ctx)
    const store = useDisasterWarningStore()
    await mode.enter()
    expect(store.activeTab).toBe('loss')
    mode.setTab('warning')
    expect(store.activeTab).toBe('warning')
    mode.setTab('tasks')
    expect(store.activeTab).toBe('tasks')
  })
})

describe('useDisasterWarningMode · T5 图层装配与播放（R2-3/R2-4/R3-6/R3-19/R3-20/R3-22）', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  function readyMode() {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return track
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnings
      if (url.endsWith('/underwriting.json')) return underwriting
      if (url.endsWith('/risk-model.json')) return riskModel
      if (url.includes('/data/boundary/county/')) return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: '330382', name: '乐清市' }, geometry: { type: 'Polygon', coordinates: [[[120.9, 28.1], [121.2, 28.1], [121.2, 28.4], [120.9, 28.4], [120.9, 28.1]]] } }] }
      throw new Error(`${url} -> 404`)
    })
    const { ctx } = makeCtx()
    const mode = useDisasterWarningMode(ctx)
    const store = useDisasterWarningStore()
    return { ctx, mode, store }
  }

  const fakeMap = {
    createPane: vi.fn(() => ({ style: {} })),
    getPane: vi.fn(),
    getContainer: () => ({ addEventListener: vi.fn() }),
    latLngToContainerPoint: vi.fn(() => ({ x: 0, y: 0 })),
    on: vi.fn(), off: vi.fn(),
  } as never

  it('init 装配三图层控制器并自动开始播放（R2-3 进入即自动播放）', async () => {
    const { mode, store } = readyMode()
    mode.init(fakeMap)
    await mode.enter()
    await vi.waitFor(() => expect(store.phase).toBe('ready'))
    // 播放已启动（R2-3 进入即自动播放）
    expect(store.playing).toBe(true)
    expect(store.nodeIndex).toBe(0)
  })

  it('togglePlay 暂停/继续；closePlayback 退出受灾预警（R2-4/R2-5）', async () => {
    const { mode, store } = readyMode()
    mode.init(fakeMap)
    await mode.enter()
    await vi.waitFor(() => expect(store.phase).toBe('ready'))
    mode.togglePlay()
    expect(store.playing).toBe(false)
    mode.togglePlay()
    expect(store.playing).toBe(true)
    mode.closePlayback()
    expect(store.isOpen).toBe(false)
  })

  it('selectVillage 补齐完整路径下钻到村（R3-7/R3-10）', async () => {
    const { ctx, mode, store } = readyMode()
    store.open()
    store.receive(store.generation, { track: { ...track, datas: [{ time_ymdh: '2026-07-09 00:00:00', lat: 28.1, lon: 121.2 }, { time_ymdh: '2026-07-10 00:00:00', lat: 28.2, lon: 121.1 }] }, precip, warnings, underwriting, riskModel })
    store.close()
    await mode.enter()
    await vi.waitFor(() => expect(store.phase).toBe('ready'))
    const warnWithVillage = {
      ...warnings,
      villages: [{ code: '330382101001', name: '示例村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.0, lat: 28.2, seatSource: 'seat' as const }],
    }
    store.receive(store.generation, { track, precip, warnings: warnWithVillage, underwriting, riskModel })
    const navigateTo = ctx.store.navigateTo as ReturnType<typeof vi.fn>
    await mode.selectVillage('330382101001')
    expect(navigateTo).toHaveBeenCalled()
    const crumbs = navigateTo.mock.calls[0]![0] as Array<{ level: string; code: string }>
    expect(crumbs[crumbs.length - 1]).toMatchObject({ level: 'village', code: '330382101001' })
  })

  it('selectCounty 下钻到区县（R3-20）', async () => {
    const { ctx, mode, store } = readyMode()
    await mode.enter()
    await vi.waitFor(() => expect(store.phase).toBe('ready'))
    const navigateTo = ctx.store.navigateTo as ReturnType<typeof vi.fn>
    await mode.selectCounty('330382')
    expect(navigateTo).toHaveBeenCalled()
    const crumbs = navigateTo.mock.calls[0]![0] as Array<{ level: string; code: string }>
    expect(crumbs.some((c) => c.level === 'county' && c.code === '330382')).toBe(true)
  })

  it('onLoopRestart 循环回起点重置演示状态（R5-7）', async () => {
    const { store } = readyMode()
    store.open()
    store.receive(store.generation, { track: { ...track, datas: [{ time_ymdh: '2026-07-09 00:00:00', lat: 28.1, lon: 121.2 }, { time_ymdh: '2026-07-10 00:00:00', lat: 28.2, lon: 121.1 }] }, precip, warnings, underwriting, riskModel })
    // 造一个任务与派发记录
    store.createTask({ villageCode: '330382101001', villageName: '示例村', type: 'prevent', nodeIndex: 1, nodeTimeLabel: '7/10 00时', warningLevel: 2, lon: 121, lat: 28.2 })
    store.setNode(1)
    // 触发循环重置（模拟 playback onLoopRestart）
    // 通过 store.resetRound 断言循环重置行为
    store.resetRound()
    expect(store.tasks.length).toBe(0)
    expect(store.nodeIndex).toBe(0)
    expect(store.dispatchedKeys.length).toBe(0)
  })
})
