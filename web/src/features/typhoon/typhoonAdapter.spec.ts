import { describe, expect, it } from 'vitest'
import { adaptTyphoonDetail, adaptTyphoonList } from './typhoonAdapter'
import { forecastIsDisplayable } from './typhoonForecast'

function observation(time: string, speed = 20, extra: Record<string, unknown> = {}) {
  return { time_ymdh: time, lat: 20, lon: 120, wind_speed_ms: speed, ...extra }
}

describe('typhoon adapter', () => {
  it('保守适配列表、统一编号为 string 并跳过非法 type', () => {
    const result = adaptTyphoonList({ code: 200, list: [
      { no1: 123, type: 'start', namecn: '甲', nameen: 'A' },
      { no1: '456', type: 'stop', namecn: '乙' },
      { no1: '789', type: 'moving' },
    ] })
    expect(result.summaries.map(({ id, status }) => ({ id, status }))).toEqual([{ id: '123', status: 'start' }, { id: '456', status: 'stop' }])
    expect(result.anomalies).toEqual(['list[2] 无效'])
  })

  it('保留 API 顺序、以 sourceIndex 构造节点 ID，并稳定派生升降序', () => {
    const detail = adaptTyphoonDetail({ code: 200, no1: 't1', type: 'start', namecn: '甲', nameen: 'A', datas: [
      observation('2026-08-01 12:00:00'),
      observation('2026-08-01 09:00:00'),
      observation('2026-08-01 12:00:00'),
    ] })!
    expect(detail.observationsApiOrder.map((node) => node.id)).toEqual(['t1:obs:0', 't1:obs:1', 't1:obs:2'])
    expect(detail.observationsAsc.map((node) => node.sourceIndex)).toEqual([1, 0, 2])
    expect(detail.observationsDesc.map((node) => node.sourceIndex)).toEqual([0, 2, 1])
  })

  it('拒绝无效日期、坐标、风速和规格缝隙，不用其他字段猜测', () => {
    const detail = adaptTyphoonDetail({ code: 200, no1: 't1', type: 'start', datas: [
      observation('2026-02-30 00:00:00'),
      observation('2026-08-01 00:00:00', 20, { lat: 91 }),
      observation('2026-08-01 00:00:00', 24.45),
      observation('2026-08-01 00:00:00', 20),
    ] })!
    expect(detail.observationsApiOrder).toHaveLength(1)
    expect(detail.anomalies).toHaveLength(3)
  })

  it('预测整套校验、同 forecast_hour 保原序、保留 target_time 原字段', () => {
    const detail = adaptTyphoonDetail({ code: 200, no1: 't1', type: 'start', datas: [observation('2026-08-01 00:00:00', 20, {
      forecast_babj: [
        { forecast_hour: 24, lat: 21, lon: 121, wind_speed_ms: 18, target_time_ymdh: 'raw-a' },
        { forecast_hour: 12, lat: 22, lon: 122, wind_speed_ms: 19, target_time_ymdh: 'raw-b' },
        { forecast_hour: 24, lat: 23, lon: 123, wind_speed_ms: 20, target_time_ymdh: 'raw-c' },
      ],
    })] })!
    const snapshot = detail.latestObservation!.forecastSnapshot!
    expect(snapshot.nodes.map((node) => [node.forecastHour, node.sourceIndex, node.targetTimeYmdh])).toEqual([[12, 1, 'raw-b'], [24, 0, 'raw-a'], [24, 2, 'raw-c']])
  })

  it.each([
    [{ forecast_hour: 12, lat: 21, lon: 121 }],
    [{ forecast_hour: 12, lat: 91, lon: 121, wind_speed_ms: 20 }],
    [{ forecast_hour: 12, lat: 21, lon: 121, wind_speed_ms: 24.45 }],
  ])('任一坏预测使整套快照拒绝：%j', (forecast) => {
    const detail = adaptTyphoonDetail({ code: 200, no1: 't1', type: 'start', datas: [observation('2026-08-01 00:00:00', 20, { forecast_babj: forecast })] })!
    expect(detail.latestObservation!.forecastSnapshot).toBeNull()
  })

  it('历史预测默认禁止展示，只有显式确认历史版本才允许', () => {
    const detail = adaptTyphoonDetail({ code: 200, no1: 'h1', type: 'stop', datas: [observation('2026-08-01 00:00:00', 20, {
      forecast_babj: [{ forecast_hour: 12, lat: 21, lon: 121, wind_speed_ms: 20 }],
    })] })!
    expect(detail.latestObservation!.forecastSnapshot?.historicalVersionConfirmed).toBe(false)
    expect(forecastIsDisplayable(detail.latestObservation!.forecastSnapshot, 'stop')).toBe(false)
  })

  it('只接受明确官方参考位置候选并忽略未知类似字段', () => {
    const detail = adaptTyphoonDetail({ code: 200, no1: 't', type: 'start', datas: [observation('2026-08-01 00:00:00', 20, { reference_text: '官方原文', nearby_city: '不可用' })] })!
    expect(detail.latestObservation!.officialReferenceText).toBe('官方原文')
  })
})
