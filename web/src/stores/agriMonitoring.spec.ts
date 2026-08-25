import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAgriMonitoringStore } from './agriMonitoring'
import type { VillageGrowth, NdviRaster } from '../features/agri-monitoring/agriMonitoringTypes'

function makeRaster(dates: string[]): NdviRaster {
  return { originLon: 120, originLat: 30, stepLon: 0.01, stepLat: 0.01, cols: 1, rows: 1, dates, layers: [dates.map(() => 60)] }
}

const village: VillageGrowth = {
  code: '330604102014', name: '龙江村', centroid: { lon: 120.86, lat: 29.78, name: '龙江村' },
  insuredAreaMu: 100, householdCount: 10, policyCount: 1,
  levels: { veryPoor: 0.1, poor: 0.5, normal: 0.2, good: 0.15, excellent: 0.05 },
  anomalyRatio: 0.6, isAnomaly: true, countyCode: '330604', cityCode: '330600', townshipCode: '330604104000', data: true,
}

describe('useAgriMonitoringStore', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('receive 默认选最近一期（最后日期）', () => {
    const store = useAgriMonitoringStore()
    store.open()
    const raster = makeRaster(['2026-06-01', '2026-06-08', '2026-06-15'])
    store.receive(store.generation, { raster })
    expect(store.phase).toBe('ready')
    expect(store.selectedDate).toBe(2) // 最近一期 = 最后日期
    expect(store.currentDateLabel).toBe('2026-06-15')
  })

  it('播放到最后一期自动停止（R2-7）', () => {
    vi.useFakeTimers()
    const store = useAgriMonitoringStore()
    store.open()
    store.receive(store.generation, { raster: makeRaster(['2026-06-01', '2026-06-08', '2026-06-15']) })
    store.selectDate(0)
    store.startPlay()
    // 推进到最后一期
    vi.advanceTimersByTime(1400 * 3)
    expect(store.selectedDate).toBe(2)
    expect(store.playing).toBe(false) // 自动停止
    vi.useRealTimers()
  })

  it('一键转任务：生成待领取任务 + 去重（R6-1/R6-3）', () => {
    const store = useAgriMonitoringStore()
    store.open()
    const task = store.createTaskFromAnomaly(village)
    expect(task).not.toBeNull()
    expect(task!.status).toBe('待领取')
    expect(task!.executor).toBeNull()
    expect(store.generatedTasks).toHaveLength(1)
    // 同一异常重复点击不重复生成
    const again = store.createTaskFromAnomaly(village)
    expect(again).toBeNull()
    expect(store.generatedTasks).toHaveLength(1)
  })

  it('退出任务详情时定位图标移除（taskLocation 清除，R5-5）', () => {
    const store = useAgriMonitoringStore()
    store.open()
    store.setTaskLocation({ lon: 120, lat: 30, name: 'x' })
    expect(store.taskLocation).not.toBeNull()
    store.openTask('task-1')
    store.closeTask()
    expect(store.taskLocation).toBeNull()
  })
})
