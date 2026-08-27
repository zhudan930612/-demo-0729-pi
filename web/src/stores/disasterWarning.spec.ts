import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDisasterWarningStore } from './disasterWarning'
import type { DisasterRiskModel } from '../features/disaster-warning/types'

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
  schemaVersion: 1, seed: 'x', sumInsuredPerMu: 1250, targetTotalMu: 12000000,
  villages: [{ code: '330382101001', name: '示例村', insuredAreaMu: 100, householdCount: 10, sumInsuredYuan: 125000, source: 'mock' as const }],
}
const riskModel: DisasterRiskModel = {
  schemaVersion: 1,
  riskLevelFromCumRainMm: [
    { max: 50, level: 0 as const, name: '无', coefficient: 0.2 },
    { min: 50, max: 100, level: 1 as const, name: '低', coefficient: 0.4 },
    { min: 100, max: 150, level: 2 as const, name: '中', coefficient: 0.7 },
    { min: 150, level: 3 as const, name: '高', coefficient: 1.0 },
  ],
  lossRateByWarningLevel: [
    { level: 1 as const, name: '低', lossRate: 0.03 },
    { level: 2 as const, name: '中', lossRate: 0.08 },
    { level: 3 as const, name: '高', lossRate: 0.15 },
  ],
  formula: '预估受灾面积 = Σ(预警村承保面积 × 村级风险系数 × 损失率)',
}
const snapshot = { track, precip, warnings, underwriting, riskModel }

describe('disasterWarning store', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('open 置 loading + 打开 + 默认灾损预估 tab', () => {
    const store = useDisasterWarningStore()
    store.open()
    expect(store.isOpen).toBe(true)
    expect(store.phase).toBe('loading')
    expect(store.activeTab).toBe('loss')
    expect(store.dispatchMode).toBe('manual') // R5-9 默认人工
  })

  it('receive 置 ready 并填充数据；generation 不匹配时拒绝', () => {
    const store = useDisasterWarningStore()
    store.open()
    const gen = store.generation
    expect(store.receive(gen, snapshot)).toBe(true)
    expect(store.phase).toBe('ready')
    expect(store.track?.namecn).toBe('巴威')
    expect(store.underwriting?.villages.length).toBe(1)
    expect(store.receive(gen - 1, snapshot)).toBe(false)
  })

  it('fail 置 error；generation 不匹配时拒绝', () => {
    const store = useDisasterWarningStore()
    store.open()
    const gen = store.generation
    expect(store.fail(gen, '404')).toBe(true)
    expect(store.phase).toBe('error')
    expect(store.errorMessage).toBe('404')
    expect(store.fail(gen - 1, 'stale')).toBe(false)
    expect(store.errorMessage).toBe('404')
  })

  it('setTab 切换 tab', () => {
    const store = useDisasterWarningStore()
    store.open()
    store.setTab('warning')
    expect(store.activeTab).toBe('warning')
    store.setTab('tasks')
    expect(store.activeTab).toBe('tasks')
  })

  it('close 清除全部状态并关闭', () => {
    const store = useDisasterWarningStore()
    store.open()
    store.receive(store.generation, snapshot)
    store.setTab('warning')
    store.close()
    expect(store.isOpen).toBe(false)
    expect(store.phase).toBe('closed')
    expect(store.track).toBeNull()
    expect(store.activeTab).toBe('loss')
  })

  it('nodeCount 来自轨迹节点数', () => {
    const store = useDisasterWarningStore()
    store.open()
    store.receive(store.generation, snapshot)
    expect(store.nodeCount).toBe(1)
  })

  it('setNode 在节点范围内推进；越界被夹紧', () => {
    const store = useDisasterWarningStore()
    store.open()
    store.receive(store.generation, snapshot)
    expect(store.nodeIndex).toBe(0)
    store.setNode(5)
    expect(store.nodeIndex).toBe(0) // nodeCount=1 → 夹紧到 0
  })

  it('createTask 生成 YJ- 编号任务 + 去重（R5-4）', () => {
    const store = useDisasterWarningStore()
    store.open()
    store.receive(store.generation, snapshot)
    const t1 = store.createTask({ villageCode: '330382101001', villageName: '示例村', type: 'prevent', nodeIndex: 0, nodeTimeLabel: '7/9 00时', warningLevel: 2, lon: 121.0, lat: 28.2 })
    expect(t1).not.toBeNull()
    expect(t1!.taskNo).toBe('YJ-2026-0001')
    expect(t1!.status).toBe('待领取')
    expect(store.isDispatched('330382101001')).toBe(true)
    // 同村同类型去重
    const t2 = store.createTask({ villageCode: '330382101001', villageName: '示例村', type: 'prevent', nodeIndex: 0, nodeTimeLabel: '7/9 00时', warningLevel: 2, lon: 121.0, lat: 28.2 })
    expect(t2).toBeNull()
    // 高风险绑定两条（R5-8）：prevent + inspect
    const t3 = store.createTask({ villageCode: '330382101002', villageName: '高风险村', type: 'inspect', nodeIndex: 0, nodeTimeLabel: '7/9 00时', warningLevel: 3, lon: 121.1, lat: 28.3 })
    expect(t3).not.toBeNull()
    expect(t3!.taskNo).toBe('YJ-2026-0002')
    expect(store.tasks.length).toBe(2)
  })

  it('advanceTaskStatuses 三段流转：第一段末→进行中、第二段末→已完成（R5-6）', () => {
    const store = useDisasterWarningStore()
    store.open()
    const multiTrack = { ...track, datas: Array.from({ length: 7 }, (_, i) => ({ time_ymdh: `2026-07-0${i + 1} 00:00:00`, lat: 28, lon: 121 })) }
    store.receive(store.generation, { ...snapshot, track: multiTrack })
    store.createTask({ villageCode: '330382101001', villageName: '示例村', type: 'prevent', nodeIndex: 0, nodeTimeLabel: '7/9 00时', warningLevel: 2, lon: 121, lat: 28.2 })
    // 窗口 7 节点，span = 6，seg1 = 0 + 2，seg2 = 0 + 4
    store.advanceTaskStatuses(1)
    expect(store.tasks[0]!.status).toBe('待领取')
    store.advanceTaskStatuses(2)
    expect(store.tasks[0]!.status).toBe('进行中')
    store.advanceTaskStatuses(4)
    expect(store.tasks[0]!.status).toBe('已完成')
    expect(store.tasks[0]!.evidence.length).toBeGreaterThan(0) // 已完成挂预生成证据（R6-1）
  })

  it('升级/解除联动：任务保留 + 追加记录（R5-2/R5-3/R5-5）', () => {
    const store = useDisasterWarningStore()
    store.open()
    store.receive(store.generation, snapshot)
    store.createTask({ villageCode: '330382101001', villageName: '示例村', type: 'prevent', nodeIndex: 0, nodeTimeLabel: '7/9 00时', warningLevel: 2, lon: 121, lat: 28.2 })
    store.updateTaskWarningLevel('330382101001', 3, '7/11 00时')
    expect(store.tasks[0]!.warningLevel).toBe(3)
    expect(store.tasks[0]!.history.some((h) => h.text.includes('升级'))).toBe(true)
    store.releaseTasksForVillage('330382101001', '7/12 00时')
    expect(store.tasks[0]!.released).toBe(true)
    expect(store.tasks[0]!.history.some((h) => h.text.includes('解除'))).toBe(true)
    expect(store.tasks.length).toBe(1) // 任务保留
  })

  it('resetRound 循环回起点清零（R5-7）', () => {
    const store = useDisasterWarningStore()
    store.open()
    store.receive(store.generation, snapshot)
    store.createTask({ villageCode: '330382101001', villageName: '示例村', type: 'prevent', nodeIndex: 0, nodeTimeLabel: '7/9 00时', warningLevel: 2, lon: 121, lat: 28.2 })
    store.setNode(3)
    store.resetRound()
    expect(store.tasks.length).toBe(0)
    expect(store.nodeIndex).toBe(0)
    expect(store.dispatchedKeys.length).toBe(0)
  })
})
