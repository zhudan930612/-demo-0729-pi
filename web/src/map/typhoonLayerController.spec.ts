import { describe, expect, it, vi } from 'vitest'

vi.mock('leaflet', () => ({ default: {} }))

import type { ForecastSnapshot, ObservationNode, TyphoonDetail, WindRadius } from '../features/typhoon/typhoonTypes'
import {
  buildTyphoonScenes,
  createTyphoonSceneRegistry,
  TYPHOON_GUARD_LINES,
  TYPHOON_PANES,
  type TyphoonLayerSnapshot,
} from './typhoonLayerController'

const radii: WindRadius[] = [
  { grade: '12', gradeText: '十二级', neRadiusKm: 50, seRadiusKm: 45, swRadiusKm: 40, nwRadiusKm: 48 },
  { grade: '7', gradeText: '七级', neRadiusKm: 200, seRadiusKm: 180, swRadiusKm: 160, nwRadiusKm: 190 },
  { grade: '10', gradeText: '十级', neRadiusKm: 100, seRadiusKm: 90, swRadiusKm: 80, nwRadiusKm: 95 },
]

function node(typhoonId: string, index: number, options: Partial<ObservationNode> = {}): ObservationNode {
  return {
    id: `${typhoonId}:obs:${index}`,
    sourceIndex: index,
    timeYmdh: `2026-08-0${index + 1} 08:00:00`,
    epochMs: index,
    lat: 20 + index,
    lon: 120 + index,
    windSpeedMs: 18 + index,
    windRadii: [],
    forecastSnapshot: null,
    ...options,
  }
}

function forecast(observationId: string, historicalVersionConfirmed: boolean): ForecastSnapshot {
  return {
    observationId,
    historicalVersionConfirmed,
    maxForecastHour: 24,
    nodes: [
      { id: `${observationId}:forecast:0`, sourceIndex: 0, forecastHour: 12, lat: 24, lon: 124, windSpeedMs: 24 },
      { id: `${observationId}:forecast:1`, sourceIndex: 1, forecastHour: 24, lat: 25, lon: 125, windSpeedMs: 35 },
    ],
  }
}

function detail(id: string, status: 'start' | 'stop', nodes: ObservationNode[]): TyphoonDetail {
  return {
    id,
    nameCn: id,
    nameEn: id.toUpperCase(),
    status,
    sourceIndex: 0,
    observationsApiOrder: nodes,
    observationsAsc: nodes,
    observationsDesc: [...nodes].reverse(),
    latestObservation: nodes[nodes.length - 1] ?? null,
    anomalies: [],
  }
}

function snapshot(realtime: TyphoonDetail[], historical: TyphoonDetail[] = [], selected: Record<string, string> = {}): TyphoonLayerSnapshot {
  return {
    realtime: realtime.map((item) => ({ detail: item })),
    historical: historical.map((item) => ({ detail: item })),
    focusedTyphoonId: realtime[0]?.id ?? historical[0]?.id ?? null,
    selectedNodeByTyphoon: selected,
  }
}

describe('typhoon layer scene builder', () => {
  it('保留全部实际和预测节点并从预测所属实际点连接', () => {
    const nodes = [node('live', 0), node('live', 1), node('live', 2)]
    nodes[2] = { ...nodes[2]!, forecastSnapshot: forecast(nodes[2]!.id, true) }
    const [scene] = buildTyphoonScenes(snapshot([detail('live', 'start', nodes)]))
    expect(scene!.actualPoints.map((point) => point.id)).toEqual(nodes.map((item) => item.id))
    expect(scene!.forecastPoints).toHaveLength(2)
    expect(scene!.forecastPath).toEqual([[22, 122], [24, 124], [25, 125]])
  })

  it('visibleObservationCount 只裁剪动画显示部分而不改变领域数据', () => {
    const nodes = [node('history', 0), node('history', 1), node('history', 2)]
    const historical = detail('history', 'stop', nodes)
    const [scene] = buildTyphoonScenes({
      realtime: [],
      historical: [{ detail: historical, visibleObservationCount: 2 }],
      focusedTyphoonId: 'history',
      selectedNodeByTyphoon: { history: nodes[1]!.id },
    })
    expect(scene!.actualNodes).toEqual(nodes.slice(0, 2))
    expect(scene!.actualPath).toHaveLength(2)
    expect(historical.observationsAsc).toHaveLength(3)
  })

  it('实时默认最新中心与风圈，历史只有选中节点才显示风圈', () => {
    const liveNodes = [node('live', 0), node('live', 1, { windRadii: radii })]
    const historyNodes = [node('history', 0, { windRadii: radii })]
    const scenes = buildTyphoonScenes(snapshot([detail('live', 'start', liveNodes)], [detail('history', 'stop', historyNodes)]))
    expect(scenes[0]!.centerNode?.id).toBe(liveNodes[1]!.id)
    expect(scenes[0]!.windCircles.map((circle) => circle.grade)).toEqual(['7', '10', '12'])
    expect(scenes[1]!.centerNode).toBeNull()
    expect(scenes[1]!.windCircles).toEqual([])

    const selected = buildTyphoonScenes(snapshot([], [detail('history', 'stop', historyNodes)], { history: historyNodes[0]!.id }))[0]!
    expect(selected.centerNode?.id).toBe(historyNodes[0]!.id)
    expect(selected.windCircles.every((circle) => circle.polygon.length > 4)).toBe(true)
  })

  it('历史预测仅在明确确认历史版本后展示', () => {
    const observation = node('history', 0)
    const blocked = { ...observation, forecastSnapshot: forecast(observation.id, false) }
    const allowed = { ...observation, forecastSnapshot: forecast(observation.id, true) }
    expect(buildTyphoonScenes(snapshot([], [detail('history', 'stop', [blocked])]))[0]!.forecastNodes).toEqual([])
    expect(buildTyphoonScenes(snapshot([], [detail('history', 'stop', [allowed])]))[0]!.forecastNodes).toHaveLength(2)
  })

  it('多个台风各自构建，不合并坐标或节点', () => {
    const scenes = buildTyphoonScenes(snapshot([
      detail('a', 'start', [node('a', 0)]),
      detail('b', 'start', [node('b', 0), node('b', 1)]),
    ]))
    expect(scenes.map((scene) => [scene.id, scene.actualNodes.length])).toEqual([['a', 1], ['b', 2]])
  })
})

describe('typhoon layer resource contract', () => {
  it('所有专题 pane 明确低于 annotationPane 且层次严格递增', () => {
    const panes = Object.values(TYPHOON_PANES)
    expect(panes.map((pane) => pane.zIndex)).toEqual([410, 411, 412, 415, 420, 425, 430, 435])
    expect(TYPHOON_PANES.wind12.zIndex).toBeGreaterThan(TYPHOON_PANES.wind10.zIndex)
    expect(TYPHOON_PANES.wind10.zIndex).toBeGreaterThan(TYPHOON_PANES.wind7.zIndex)
    expect(panes.every((pane) => pane.zIndex < 450)).toBe(true)
  })

  it('警戒线定义唯一、固定坐标为 lat/lon 且线型不同', () => {
    expect(TYPHOON_GUARD_LINES.map((line) => line.id)).toEqual(['24h', '48h'])
    expect(TYPHOON_GUARD_LINES[0].coordinates[0]).toEqual([34.005024, 126.993568])
    expect(TYPHOON_GUARD_LINES[1].coordinates.at(-1)).toEqual([33.959474, 131.981361])
    expect(TYPHOON_GUARD_LINES[0].dashArray).toBeUndefined()
    expect(TYPHOON_GUARD_LINES[1].dashArray).toBe('8 6')
  })

  it('registry 独立替换、按台风移除并在 clear 时释放全部资源', () => {
    const dispose = vi.fn()
    const registry = createTyphoonSceneRegistry(dispose)
    const a1 = { id: 'a1' }
    const a2 = { id: 'a2' }
    const b = { id: 'b' }
    registry.replace('a', a1)
    registry.replace('b', b)
    registry.replace('a', a2)
    expect(dispose).toHaveBeenCalledWith(a1)
    expect(registry.keys().sort()).toEqual(['a', 'b'])
    expect(registry.remove('a')).toBe(true)
    expect(dispose).toHaveBeenCalledWith(a2)
    expect(registry.has('b')).toBe(true)
    registry.clear()
    expect(dispose).toHaveBeenCalledWith(b)
    expect(registry.keys()).toEqual([])
  })
})
