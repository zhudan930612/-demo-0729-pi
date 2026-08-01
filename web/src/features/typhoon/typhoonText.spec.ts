import { describe, expect, it } from 'vitest'
import { adaptTyphoonDetail } from './typhoonAdapter'
import { displayValue, futureTrendText, referencePositionText } from './typhoonText'

function node(extra: Record<string, unknown> = {}) {
  return adaptTyphoonDetail({ code: 200, no1: 't', type: 'start', datas: [{ time_ymdh: '2026-08-01 00:00:00', lat: 20, lon: 120, wind_speed_ms: 20, ...extra }] })!.latestObservation!
}

describe('typhoon text fallbacks', () => {
  it('缺失展示字段统一为 --，不改变领域值', () => {
    expect(displayValue(undefined)).toBe('--')
    expect(displayValue(null)).toBe('--')
    expect(displayValue('')).toBe('--')
    expect(displayValue(0)).toBe('0')
  })

  it('参考位置只使用官方原文，缺失不编造', () => {
    expect(referencePositionText(node({ reference_position_text: '官方参考位置' }))).toBe('官方参考位置')
    expect(referencePositionText(node({ nearby_city: '某城市' }))).toBe('暂无参考位置')
  })

  it('未来趋势优先 API forecast_desc 并标来源', () => {
    const result = futureTrendText(node({ move_desc: '移动描述', forecast_babj: [{ forecast_hour: 12, lat: 21, lon: 121, wind_speed_ms: 20, forecast_desc: 'API 预报原文' }] }))
    expect(result).toEqual({ text: 'API 预报原文', source: 'api' })
  })

  it('依次回退移动描述、方向速度、预测节点和暂无', () => {
    expect(futureTrendText(node({ move_desc: '向西移动' }))).toEqual({ text: '向西移动', source: 'application' })
    expect(futureTrendText(node({ move_dir_text: '西北', move_speed_kmh: 20 }))).toEqual({ text: '将以每小时20公里的速度向西北方向移动', source: 'application' })
    expect(futureTrendText(node({ forecast_babj: [{ forecast_hour: 12, lat: 21, lon: 121, wind_speed_ms: 20 }] }))).toEqual({ text: '已提供未来12小时预测节点', source: 'application' })
    expect(futureTrendText(node())).toEqual({ text: '暂无预报信息', source: 'none' })
  })
})
