import { describe, expect, it } from 'vitest'
import type { ObservationNode, TyphoonDetail, WindRadius } from './typhoonTypes'
import { actualNodeSelection, buildTyphoonHoverViewModel } from './typhoonHoverViewModel'

const radii: WindRadius[] = [
  { grade: '7', gradeText: '七级风圈', neRadiusKm: 200, seRadiusKm: 180, swRadiusKm: 160, nwRadiusKm: 190 },
  { grade: '12', gradeText: '十二级风圈', neRadiusKm: 60, seRadiusKm: 50, swRadiusKm: 40, nwRadiusKm: 55 },
]
function node(id: string, overrides: Partial<ObservationNode> = {}): ObservationNode {
  return { id, sourceIndex: 0, timeYmdh: '2026-08-01 20:00:00', epochMs: 1, lat: 21.6, lon: 156.2, windSpeedMs: 58, pressureHpa: 925, intensityText: '超强台风', moveSpeedKmh: 24, moveDirectionText: '西北西', officialReferenceText: '<b>官方位置</b>', windRadii: radii, forecastSnapshot: { observationId: id, maxForecastHour: 12, historicalVersionConfirmed: true, nodes: [{ id: `${id}:f`, sourceIndex: 0, forecastHour: 12, lat: 22, lon: 155, windSpeedMs: 55, forecastDescription: '<script>API预报</script>' }] }, ...overrides }
}
function detail(id: string, observation: ObservationNode, status: 'start' | 'stop' = 'start'): TyphoonDetail {
  return { id, nameCn: `中文${id}`, nameEn: `EN-${id}`, status, sourceIndex: 0, observationsApiOrder: [observation], observationsAsc: [observation], observationsDesc: [observation], latestObservation: observation, anomalies: [] }
}

describe('typhoon hover view model', () => {
  it('严格按 typhoonId/nodeId 取值且 API 文本保持纯文本', () => {
    const a = detail('a', node('a:n'))
    const b = detail('b', node('b:n', { pressureHpa: 980 }))
    const model = buildTyphoonHoverViewModel({ a, b }, { kind: 'center', typhoonId: 'a', nodeId: 'a:n' })
    expect(model?.kind).toBe('center')
    if (model?.kind !== 'center') return
    expect(model.pressure).toBe('925 hPa')
    expect(model.referencePosition).toBe('<b>官方位置</b>')
    expect(model.trend).toBe('<script>API预报</script>')
    expect(model.trendSource).toBe('API 原文')
  })

  it('缺失风圈级显示 -- 并完整提供四象限', () => {
    const d = detail('a', node('a:n'))
    const center = buildTyphoonHoverViewModel({ a: d }, { kind: 'center', typhoonId: 'a', nodeId: 'a:n' })
    expect(center?.kind === 'center' && center.radius10).toBe('--')
    const wind = buildTyphoonHoverViewModel({ a: d }, { kind: 'wind', typhoonId: 'a', nodeId: 'a:n', grade: '7' })
    expect(wind?.kind === 'wind' && [wind.northwest, wind.northeast, wind.southwest, wind.southeast]).toEqual(['190 km', '200 km', '160 km', '180 km'])
  })

  it('参考位置与趋势按回退优先级并标记应用生成来源', () => {
    const d = detail('a', node('a:n', { officialReferenceText: undefined, forecastSnapshot: null, moveDescription: '向西移动' }))
    const model = buildTyphoonHoverViewModel({ a: d }, { kind: 'center', typhoonId: 'a', nodeId: 'a:n' })
    expect(model?.kind === 'center' && [model.referencePosition, model.trend, model.trendSource]).toEqual(['暂无参考位置', '向西移动', '应用生成'])
  })

  it('预测点不会污染 actual selected node，历史实际点返回完整可见数量', () => {
    const d = detail('a', node('a:n'), 'stop')
    expect(actualNodeSelection(d, 'forecast', 'a:n:f')).toBeNull()
    expect(actualNodeSelection(d, 'actual', 'missing')).toBeNull()
    expect(actualNodeSelection(d, 'actual', 'a:n')).toEqual({ typhoonId: 'a', nodeId: 'a:n', visibleObservationCount: 1 })
  })
})
