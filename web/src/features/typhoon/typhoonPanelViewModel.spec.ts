import { describe, expect, it } from 'vitest'
import type { ObservationNode, TyphoonDetail } from './typhoonTypes'
import { buildTyphoonPathPanelViewModel, compactBeijingTime } from './typhoonPanelViewModel'

function node(id: string, sourceIndex: number, overrides: Partial<ObservationNode> = {}): ObservationNode {
  return {
    id,
    sourceIndex,
    timeYmdh: `2026-08-0${sourceIndex + 1} 0${sourceIndex + 8}:00:00`,
    epochMs: sourceIndex,
    lat: 20 + sourceIndex,
    lon: 120 + sourceIndex,
    windSpeedMs: 18 + sourceIndex,
    windRadii: [],
    forecastSnapshot: null,
    ...overrides,
  }
}

function detail(id: string, status: 'start' | 'stop', nodes: ObservationNode[], domesticNo?: string): TyphoonDetail {
  return {
    id,
    domesticNo,
    nameCn: `${id}中文`,
    nameEn: id.toUpperCase(),
    status,
    sourceIndex: 0,
    observationsApiOrder: nodes,
    observationsAsc: nodes,
    observationsDesc: [...nodes].reverse(),
    latestObservation: nodes.at(-1) ?? null,
    anomalies: [],
  }
}

const source = (details: Record<string, TyphoonDetail>) => ({
  liveIds: ['live-b', 'live-a'],
  openedHistoricalIds: ['history-a'],
  details,
  focusedTyphoonId: 'live-b',
  expandedIds: ['live-b', 'history-a'],
  selectedNodeByTyphoon: { 'live-b': 'live-b:0', 'history-a': 'history-a:0' },
})

describe('typhoon path panel view model', () => {
  it('严格遵守 store 的实时与历史顺序并提供动作元数据', () => {
    const first = node('live-b:0', 0)
    const vm = buildTyphoonPathPanelViewModel(source({
      'live-a': detail('live-a', 'start', [node('live-a:0', 0)]),
      'live-b': detail('live-b', 'start', [first], '2609'),
      'history-a': detail('history-a', 'stop', [node('history-a:0', 0)]),
    }))
    expect(vm.realtime.map((item) => item.id)).toEqual(['live-b', 'live-a'])
    expect(vm.historical.map((item) => item.id)).toEqual(['history-a'])
    expect(vm.cards.map((item) => item.id)).toEqual(['live-b', 'live-a', 'history-a'])
    expect(vm.realtime[0]).toMatchObject({ number: '2609', statusLabel: '实时台风', canClose: false, focused: true, expanded: true })
    expect(vm.historical[0]).toMatchObject({ number: 'history-a', statusLabel: '历史台风', canClose: true })
  })

  it('节点完整倒序且每行使用自身字段，不使用最新节点覆盖', () => {
    const older = node('live-b:0', 0, { pressureHpa: 998, intensityText: '热带风暴', windSpeedMs: 18, moveSpeedKmh: 12 })
    const latest = node('live-b:1', 1, { pressureHpa: 925, intensityText: '超强台风', windSpeedMs: 58, moveSpeedKmh: 25 })
    const vm = buildTyphoonPathPanelViewModel(source({
      'live-b': detail('live-b', 'start', [older, latest]),
      'history-a': detail('history-a', 'stop', [node('history-a:0', 0)]),
    }))
    expect(vm.realtime[0]!.nodes.map((row) => row.id)).toEqual(['live-b:1', 'live-b:0'])
    expect(vm.realtime[0]!.nodes[1]).toMatchObject({ pressure: '998', wind: '热带风暴（18m/s）', movementSpeed: '12km/h', selected: true })
  })

  it('节点表缺失字段显示 --', () => {
    const item = node('history-a:0', 0, { pressureHpa: undefined, intensityText: undefined, moveDirectionText: undefined, moveSpeedKmh: undefined, positionText: undefined })
    const vm = buildTyphoonPathPanelViewModel(source({ 'history-a': detail('history-a', 'stop', [item]) }))
    expect(vm.historical[0]!.nodes[0]).toMatchObject({ pressure: '--', movementSpeed: '--' })
  })

  it('格式化紧凑北京时间，非法时间回退 --', () => {
    expect(compactBeijingTime('2026-08-01 23:00:00')).toBe('08月01日23时')
    expect(compactBeijingTime('bad')).toBe('--')
  })
})
