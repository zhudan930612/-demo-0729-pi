import { describe, expect, it } from 'vitest'
import { adaptTyphoonDetail } from './typhoonAdapter'
import { parseBeijingDateTime } from './typhoonTime'
import { buildTyphoonTimelineViewModel } from './typhoonTimelineViewModel'

function history(id: string, times: string[]) {
  return adaptTyphoonDetail({ code: 200, no1: id, no2: `26${id}`, namecn: `台风${id}`, nameen: id.toUpperCase(), type: 'stop', datas: times.map((time) => ({ time_ymdh: time, lat: 20, lon: 120, wind_speed_ms: 20 })) })!
}
const nowMs = parseBeijingDateTime('2026-08-20 12:00:00')!

describe('typhoon timeline view model', () => {
  it('只使用当前年度有效历史详情并映射月份、生命周期宽度和 lane', () => {
    const short = history('a', ['2026-01-02 00:00:00', '2026-01-03 00:00:00'])
    const long = history('b', ['2026-01-02 00:00:00', '2026-03-10 00:00:00'])
    const old = history('old', ['2025-01-01 00:00:00'])
    const model = buildTyphoonTimelineViewModel({ details: [short, long, old], nowMs, realtimeCount: 0, openedHistoricalIds: [], focusedTyphoonId: null, selectedNodeByTyphoon: {}, historyPending: 0 })
    expect(model.months).toEqual([1, 3])
    expect(model.labels.map((label) => label.id)).toEqual(['a', 'b'])
    expect(model.labels.find((label) => label.id === 'b')!.widthPercent).toBeGreaterThan(model.labels.find((label) => label.id === 'a')!.widthPercent)
    expect(model.laneCount).toBe(2)
  })

  it('3/4/6 lane 均保留至少 50px 可点击宽度且轨道高度可由 laneCount 推导', () => {
    for (const count of [3, 4, 6]) {
      const items = Array.from({ length: count }, (_, index) => history(`lane-${index}`, ['2026-01-02 00:00:00', '2026-01-03 00:00:00']))
      const model = buildTyphoonTimelineViewModel({ details: items, nowMs, realtimeCount: 0, openedHistoricalIds: [], focusedTyphoonId: null, selectedNodeByTyphoon: {}, historyPending: 0 })
      expect(model.laneCount).toBe(count)
      expect(model.labels.every((label) => label.widthPercent / 100 * model.trackWidthPx >= 50)).toBe(true)
    }
  })

  it('分别给出实时达到上限和总数达到上限文案，已打开标签不禁用', () => {
    const item = history('a', ['2026-01-02 00:00:00'])
    const liveLimit = buildTyphoonTimelineViewModel({ details: [item], nowMs, realtimeCount: 6, openedHistoricalIds: [], focusedTyphoonId: null, selectedNodeByTyphoon: {}, historyPending: 0 })
    expect(liveLimit.labels[0]!.disabledReason).toBe('实时台风数量已达展示上限')
    const totalLimit = buildTyphoonTimelineViewModel({ details: [item], nowMs, realtimeCount: 5, openedHistoricalIds: ['another'], focusedTyphoonId: null, selectedNodeByTyphoon: {}, historyPending: 0 })
    expect(totalLimit.labels[0]!.disabledReason).toBe('台风展示数量已达上限')
    const opened = buildTyphoonTimelineViewModel({ details: [item], nowMs, realtimeCount: 6, openedHistoricalIds: ['a'], focusedTyphoonId: 'a', selectedNodeByTyphoon: {}, historyPending: 0 })
    expect(opened.labels[0]!.disabled).toBe(false)
  })

  it('加载中允许已有标签先显示，选中节点映射指示器', () => {
    const item = history('a', ['2026-01-01 00:00:00', '2026-01-11 00:00:00'])
    const model = buildTyphoonTimelineViewModel({ details: [item], nowMs, realtimeCount: 0, openedHistoricalIds: ['a'], focusedTyphoonId: 'a', selectedNodeByTyphoon: { a: item.observationsAsc[1]!.id }, historyPending: 2 })
    expect(model.loading).toBe(true)
    expect(model.empty).toBe(false)
    expect(model.labels[0]!.indicatorPercent).toBe(100)
  })
})
