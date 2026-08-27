import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDisasterWarningStore } from './disasterWarning'

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

describe('disasterWarning store', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('open 置 loading + 打开 + 默认灾损预估 tab', () => {
    const store = useDisasterWarningStore()
    store.open()
    expect(store.isOpen).toBe(true)
    expect(store.phase).toBe('loading')
    expect(store.activeTab).toBe('loss')
  })

  it('receive 置 ready 并填充数据；generation 不匹配时拒绝', () => {
    const store = useDisasterWarningStore()
    store.open()
    const gen = store.generation
    expect(store.receive(gen, { track, precip, warnings })).toBe(true)
    expect(store.phase).toBe('ready')
    expect(store.track?.namecn).toBe('巴威')
    expect(store.receive(gen - 1, { track, precip, warnings })).toBe(false)
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
    store.receive(store.generation, { track, precip, warnings })
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
    store.receive(store.generation, { track, precip, warnings })
    expect(store.nodeCount).toBe(1)
  })
})
