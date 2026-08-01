import { describe, expect, it } from 'vitest'
import { adaptTyphoonDetail } from './typhoonAdapter'
import { parseBeijingDateTime } from './typhoonTime'
import { buildTimelineModel } from './typhoonTimeline'

function history(id: string, times: string[]) {
  return adaptTyphoonDetail({ code: 200, no1: id, type: 'stop', datas: times.map((time) => ({ time_ymdh: time, lat: 20, lon: 120, wind_speed_ms: 20 })) })!
}

const now = parseBeijingDateTime('2024-03-15 12:00:00')!

describe('compressed typhoon timeline', () => {
  it('仅保留有数据月份且月份等宽，跨空月连续压缩', () => {
    const model = buildTimelineModel([history('cross', ['2024-01-31 00:00:00', '2024-03-02 00:00:00'])], now)!
    expect(model.months).toEqual([1, 3])
    expect(model.labels[0]!.startX).toBeGreaterThan(0.45)
    expect(model.labels[0]!.endX).toBeGreaterThan(0.5)
  })

  it('闰年二月按真实 29 天比例定位', () => {
    const model = buildTimelineModel([history('leap', ['2024-02-01 00:00:00', '2024-02-15 12:00:00'])], now)!
    expect(model.months).toEqual([2])
    expect(model.labels[0]!.endX).toBeCloseTo(0.5, 5)
  })

  it('跨年标签裁到当年范围但不修改原始完整 observations', () => {
    const detail = history('cross-year', ['2023-12-30 00:00:00', '2024-01-02 00:00:00'])
    const model = buildTimelineModel([detail], now)!
    expect(model.labels[0]!.startMs).toBe(parseBeijingDateTime('2024-01-01 00:00:00'))
    expect(detail.observationsAsc).toHaveLength(2)
  })

  it('单点使用最小视觉宽度且当前月不越过 now', () => {
    const model = buildTimelineModel([history('one', ['2024-03-15 12:00:00'])], now, 0.05)!
    const label = model.labels[0]!
    expect(label.endMs).toBe(now)
    expect(label.visualEndX - label.visualStartX).toBeCloseTo(0.05)
    expect(label.visualEndX).toBeLessThanOrEqual(1)
  })

  it('完全重叠标签稳定分 lane', () => {
    const model = buildTimelineModel([
      history('b', ['2024-01-01 00:00:00', '2024-01-10 00:00:00']),
      history('a', ['2024-01-01 00:00:00', '2024-01-10 00:00:00']),
    ], now)!
    expect(model.labels.map((label) => [label.typhoonId, label.lane])).toEqual([['b', 0], ['a', 1]])
    expect(model.laneCount).toBe(2)
  })
})
