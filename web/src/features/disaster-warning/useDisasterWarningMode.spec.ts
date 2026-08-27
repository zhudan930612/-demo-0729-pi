import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Ref } from 'vue'

vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})), marker: vi.fn(() => ({ addTo: vi.fn(), remove: vi.fn() })) } }))
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
