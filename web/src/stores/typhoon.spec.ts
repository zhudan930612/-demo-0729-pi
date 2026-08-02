import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { TyphoonDetail, TyphoonSummary } from '../features/typhoon/typhoonTypes'
import { useTyphoonStore } from './typhoon'

const summary = (id: string, status: 'start' | 'stop', sourceIndex = 0): TyphoonSummary => ({ id, status, sourceIndex, nameCn: id, nameEn: id })
const detail = (id: string, status: 'start' | 'stop', epochMs: number): TyphoonDetail => {
  const node = { id: `${id}:obs:0`, sourceIndex: 0, timeYmdh: '2026-01-01 00:00:00', epochMs, lat: 20, lon: 120, windSpeedMs: 20, windRadii: [], forecastSnapshot: null }
  return { ...summary(id, status), observationsApiOrder: [node], observationsAsc: [node], observationsDesc: [node], latestObservation: node, anomalies: [] }
}

describe('typhoon session store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('0 个实时台风完成后进入空态且不自动打开历史', () => {
    const store = useTyphoonStore()
    store.beginSession(1, 2026)
    store.receiveSummaries(1, [summary('h1', 'stop')])
    store.finishLiveLoading(1)
    expect(store.hasNoActiveTyphoon).toBe(true)
    expect(store.openedHistoricalIds).toEqual([])
    expect(store.timelineOpen).toBe(false)
  })

  it('多实时按最新时间排序并在全部实时完成后默认焦点第一条', () => {
    const store = useTyphoonStore()
    store.beginSession(1, 2026)
    store.receiveSummaries(1, [summary('a', 'start'), summary('b', 'start', 1)])
    store.receiveLiveDetail(1, detail('a', 'start', 100))
    store.receiveLiveDetail(1, detail('b', 'start', 200))
    store.finishLiveLoading(1)
    expect(store.liveIds).toEqual(['b', 'a'])
    expect(store.focusedTyphoonId).toBe('b')
    expect(store.expandedIds).toEqual(['b'])
  })

  it('卡片使用单开手风琴，打开新卡片自动收起原卡片', () => {
    const store = useTyphoonStore()
    store.beginSession(1, 2026)
    store.receiveSummaries(1, [summary('a', 'start'), summary('b', 'start', 1)])
    store.receiveLiveDetail(1, detail('a', 'start', 100))
    store.receiveLiveDetail(1, detail('b', 'start', 200))
    store.finishLiveLoading(1)
    store.toggleExpanded('a')
    expect(store.expandedIds).toEqual(['a'])
    store.toggleExpanded('b')
    expect(store.expandedIds).toEqual(['b'])
    store.toggleExpanded('b')
    expect(store.expandedIds).toEqual([])
  })

  it('实时达到六条时禁止打开历史', () => {
    const store = useTyphoonStore()
    store.beginSession(1, 2026)
    const summaries = [...Array.from({ length: 6 }, (_, i) => summary(`l${i}`, 'start', i)), summary('h', 'stop', 6)]
    store.receiveSummaries(1, summaries)
    store.receiveHistoricalDetail(1, detail('h', 'stop', 10))
    expect(store.openHistorical('h')).toBe(false)
  })

  it('历史关闭保留详情，重新打开排到末尾', () => {
    const store = useTyphoonStore()
    store.beginSession(1, 2026)
    store.receiveSummaries(1, [summary('h1', 'stop'), summary('h2', 'stop', 1)])
    store.receiveHistoricalDetail(1, detail('h1', 'stop', 10))
    store.receiveHistoricalDetail(1, detail('h2', 'stop', 20))
    store.openHistorical('h1'); store.openHistorical('h2'); store.closeHistorical('h1'); store.openHistorical('h1')
    expect(store.openedHistoricalIds).toEqual(['h2', 'h1'])
    expect(store.details.h1).toBeTruthy()
  })

  it('切焦点不清各台风节点，收起时间轴不关闭历史', () => {
    const store = useTyphoonStore()
    store.beginSession(1, 2026)
    store.receiveSummaries(1, [summary('a', 'start'), summary('h', 'stop')])
    store.receiveLiveDetail(1, detail('a', 'start', 10))
    store.receiveHistoricalDetail(1, detail('h', 'stop', 20))
    store.openHistorical('h')
    expect(store.selectedNodeByTyphoon.h).toBeUndefined()
    store.selectNode('a', 'a:obs:0'); store.selectNode('h', 'h:obs:0'); store.focusTyphoon('a')
    store.setTimelineOpen(true); store.setTimelineOpen(false)
    expect(store.selectedNodeByTyphoon).toEqual({ a: 'a:obs:0', h: 'h:obs:0' })
    expect(store.openedHistoricalIds).toEqual(['h'])
  })

  it('旧 session action 在退出后无效', () => {
    const store = useTyphoonStore()
    store.beginSession(1, 2026)
    store.exitSession()
    expect(store.receiveLiveDetail(1, detail('a', 'start', 10))).toBe(false)
    expect(store.phase).toBe('closed')
  })
})
