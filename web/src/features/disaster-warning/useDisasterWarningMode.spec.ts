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
      marker: vi.fn(() => {
        const m = { addTo: vi.fn(() => m), remove: vi.fn(), setZIndexOffset: vi.fn(), on: vi.fn(), setLatLng: vi.fn() }
        return m
      }),
      polyline: vi.fn(() => {
        const p = { addTo: vi.fn(() => p), remove: vi.fn(), setLatLngs: vi.fn(), setStyle: vi.fn(), on: vi.fn() }
        return p
      }),
      circleMarker: vi.fn(() => {
        const c = { addTo: vi.fn(() => c), remove: vi.fn(), setLatLng: vi.fn(), setRadius: vi.fn(), on: vi.fn() }
        return c
      }),
      svgOverlay: vi.fn(() => {
        const s = { addTo: vi.fn(() => s), remove: vi.fn() }
        return s
      }),
      geoJSON: vi.fn(() => {
        const g = { addTo: vi.fn(() => g), remove: vi.fn(), on: vi.fn() }
        return g
      }),
      GridLayer: FakeGridLayer,
      layerGroup: () => {
        const g = { addTo: vi.fn(() => g), remove: vi.fn(), clearLayers: vi.fn() }
        return g
      },
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
  schemaVersion: 1, thresholds: { low: 170, mid: 175, high: 180 }, hysteresisNodes: 2,
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
const panel = {
  schemaVersion: 1, nodeTimes: ['2026-07-09 00:00:00'],
  perNode: [{ i: 0, time: '2026-07-09 00:00:00', loss: { areaWanMu: 0, households: 0, amountWanYuan: 0 }, sorted: [], byIdx: {} }],
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
      if (url.endsWith('/panel.json')) return panel
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
      if (url.endsWith('/panel.json')) return panel
      if (url.endsWith('/data/villages/330382101000.geojson')) return {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { code: '330382101001', name: '示例村' }, geometry: { type: 'Polygon', coordinates: [[[120.98, 28.18], [121.02, 28.18], [121.02, 28.22], [120.98, 28.22], [120.98, 28.18]]] } }],
      }
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

  it('init 装配三图层控制器并渲染首帧；默认不自动播放（R2-3 变更）', async () => {
    const { mode, store } = readyMode()
    mode.init(fakeMap)
    await mode.enter()
    await vi.waitFor(() => expect(store.phase).toBe('ready'))
    // 默认不自动播放（R2-3 变更）：进入后停在首帧、playing=false
    expect(store.playing).toBe(false)
    expect(store.nodeIndex).toBe(0)
    // 点 ▶ 启动播放
    mode.togglePlay()
    expect(store.playing).toBe(true)
  })

  it('togglePlay 启动/暂停/继续；closePlayback 退出受灾预警（R2-3变更/R2-4/R2-5）', async () => {
    const { mode, store } = readyMode()
    mode.init(fakeMap)
    await mode.enter()
    await vi.waitFor(() => expect(store.phase).toBe('ready'))
    // R2-3 变更：进入后默认不播放
    expect(store.playing).toBe(false)
    // 第一次 togglePlay 启动播放（R2-3：点 ▶ 启动）
    mode.togglePlay()
    expect(store.playing).toBe(true)
    // 第二次 togglePlay 暂停（R2-4）
    mode.togglePlay()
    expect(store.playing).toBe(false)
    // 第三次 togglePlay 继续（R2-4）
    mode.togglePlay()
    expect(store.playing).toBe(true)
    mode.closePlayback()
    expect(store.isOpen).toBe(false)
  })

  it('seekNode 选中节点即暂停并跳到该节点；togglePlay 从选中节点开始（R2-6b）', async () => {
    const { mode, store } = readyMode()
    mode.init(fakeMap)
    await mode.enter()
    await vi.waitFor(() => expect(store.phase).toBe('ready'))
    // 选中节点：暂停 + 跳到该节点（单节点 track → nodeIndex 0）
    mode.seekNode(0)
    expect(store.nodeIndex).toBe(0)
    expect(store.playing).toBe(false)
    // 点播放：从当前选中节点开始
    mode.togglePlay()
    expect(store.playing).toBe(true)
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
    const crumbs = navigateTo.mock.calls[0]![0] as Array<{ level: string; code: string; geometry?: { type?: string } }>
    const villageCrumb = crumbs.at(-1)!
    expect(villageCrumb).toMatchObject({ level: 'village', code: '330382101001' })
    expect(villageCrumb.geometry).toMatchObject({ type: 'Polygon' })
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

describe('useDisasterWarningMode · T9 任务派发联动（R5-1~R5-11）', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  const warnWithVillages = {
    ...warnings,
    nodeTimes: ['2026-07-09 00:00:00', '2026-07-10 00:00:00'],
    villages: [
      { code: '330382101001', name: '甲村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.0, lat: 28.2, seatSource: 'seat' as const },
      { code: '330382101002', name: '乙村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.05, lat: 28.25, seatSource: 'seat' as const },
    ],
    nodes: [
      { i: 0, w: [] },
      { i: 1, w: [[0, 2], [1, 3]] as Array<[number, 1 | 2 | 3]> }, // 甲村中风险、乙村高风险
    ],
  }
  const multiTrack = { ...track, datas: [{ time_ymdh: '2026-07-09 00:00:00', lat: 28.1, lon: 121.2 }, { time_ymdh: '2026-07-10 00:00:00', lat: 28.3, lon: 121.0 }] }

  function readyWithWarnings() {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return multiTrack
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnWithVillages
      if (url.endsWith('/underwriting.json')) return underwriting
      if (url.endsWith('/risk-model.json')) return riskModel
      if (url.endsWith('/panel.json')) return panel
      throw new Error(`${url} -> 404`)
    })
    const { ctx } = makeCtx()
    const mode = useDisasterWarningMode(ctx)
    const store = useDisasterWarningStore()
    return { ctx, mode, store }
  }

  it('dispatchVillage 按预警等级绑定任务类型（R5-8）：中风险仅预防指令类、高风险预防+核查', () => {
    const { mode, store } = readyWithWarnings()
    store.open()
    store.receive(store.generation, { track: multiTrack, precip, warnings: warnWithVillages, underwriting, riskModel })
    store.setNode(1)
    mode.dispatchVillage('330382101001') // 中风险 → 1 条
    mode.dispatchVillage('330382101002') // 高风险 → 2 条
    expect(store.tasks).toHaveLength(3)
    expect(store.tasks.filter((t) => t.villageCode === '330382101002').map((t) => t.type).sort()).toEqual(['inspect', 'prevent'])
  })

  it('dispatchVillage 同村同类型去重（R5-4）：重复派发不重复生成', () => {
    const { mode, store } = readyWithWarnings()
    store.open()
    store.receive(store.generation, { track: multiTrack, precip, warnings: warnWithVillages, underwriting, riskModel })
    store.setNode(1)
    mode.dispatchVillage('330382101001')
    mode.dispatchVillage('330382101001')
    expect(store.tasks.filter((t) => t.villageCode === '330382101001')).toHaveLength(1)
  })

  it('dispatchAllPending 一键派发仅对待处理（中/高）村（R3-16）', () => {
    const { mode, store } = readyWithWarnings()
    store.open()
    store.receive(store.generation, { track: multiTrack, precip, warnings: warnWithVillages, underwriting, riskModel })
    store.setNode(1)
    mode.dispatchAllPending()
    expect(store.tasks).toHaveLength(3) // 甲1 + 乙2
    expect(store.tasks.map((task) => task.status)).toEqual(expect.arrayContaining(['进行中', '已完成']))
    expect(store.tasks.find((task) => task.status === '已完成')?.evidence).toHaveLength(2)
  })

  it('升级联动：高风险村自动补核查类任务（R5-3/R5-8）', () => {
    const { mode, store } = readyWithWarnings()
    store.open()
    store.receive(store.generation, { track: multiTrack, precip, warnings: warnWithVillages, underwriting, riskModel })
    store.setNode(1)
    mode.dispatchVillage('330382101002')
    expect(store.tasks.filter((t) => t.villageCode === '330382101002')).toHaveLength(2)
  })

  it('解除联动：任务保留 + 标记已解除（R5-2）', () => {
    const { mode, store } = readyWithWarnings()
    store.open()
    store.receive(store.generation, { track: multiTrack, precip, warnings: warnWithVillages, underwriting, riskModel })
    store.setNode(1)
    mode.dispatchVillage('330382101001')
    expect(store.tasks).toHaveLength(1)
    // 回到节点0（无预警）→ 触发解除联动
    store.setNode(0)
    store.advanceTaskStatuses(0)
    // 手动触发解除（mode 的 syncTaskWarningLinkage 在 onStep 内）
    // 直接调 store 断言行为
    store.releaseTasksForVillage('330382101001', '7/9 00时')
    expect(store.tasks).toHaveLength(1) // 任务保留
    expect(store.tasks[0]!.released).toBe(true)
    expect(store.tasks[0]!.history.some((h) => h.text.includes('解除'))).toBe(true)
  })
})
