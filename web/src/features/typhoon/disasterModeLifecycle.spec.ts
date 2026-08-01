import { describe, expect, it, vi } from 'vitest'
import { autoLevelAllowed, enterDisasterMode, exitDisasterMode, mapTyphoonLayerSnapshot } from './disasterModeLifecycle'
import type { TyphoonDetail } from './typhoonTypes'

function detail(id: string): TyphoonDetail {
  return { id, nameCn: id, nameEn: id, status: 'start', sourceIndex: 0, observationsApiOrder: [], observationsAsc: [], observationsDesc: [], latestObservation: null, anomalies: [] }
}

describe('disaster mode lifecycle coordinator', () => {
  it('严格等待省级全景后才启动 repository', async () => {
    const events: string[] = []
    let active = false
    let resolvePanorama!: () => void
    const panorama = new Promise<void>((resolve) => { resolvePanorama = resolve })
    const result = enterDisasterMode({
      hasUnsavedWork: () => false,
      isActive: () => active,
      setActive: (value) => { active = value; events.push(`active:${value}`) },
      closeBusinessPanels: () => events.push('close-business'),
      hideParcelLayers: () => events.push('hide-parcels'),
      resetToProvince: async () => { events.push('reset-province'); return true },
      renderProvincePanorama: async () => { events.push('panorama:start'); await panorama; events.push('panorama:end') },
      enterRepository: () => events.push('repository'),
    })
    await Promise.resolve()
    expect(events).toEqual(['close-business', 'hide-parcels', 'active:true', 'reset-province', 'panorama:start'])
    resolvePanorama()
    await expect(result).resolves.toBe(true)
    expect(events.at(-1)).toBe('repository')
  })

  it('未保存操作阻止进入且无副作用', async () => {
    const sideEffect = vi.fn()
    await expect(enterDisasterMode({
      hasUnsavedWork: () => true, isActive: () => false, setActive: sideEffect,
      closeBusinessPanels: sideEffect, hideParcelLayers: sideEffect,
      resetToProvince: async () => { sideEffect(); return true },
      renderProvincePanorama: async () => sideEffect(), enterRepository: sideEffect,
    })).resolves.toBe(false)
    expect(sideEffect).not.toHaveBeenCalled()
  })

  it('退出只清会话与专题图层，不触碰相机', () => {
    let active = true
    const events: string[] = []
    expect(exitDisasterMode({
      isActive: () => active,
      exitRepository: () => events.push('repository:exit'),
      clearTyphoonLayers: () => events.push('layers:clear'),
      setActive: (value) => { active = value; events.push(`active:${value}`) },
    })).toBe(true)
    expect(events).toEqual(['repository:exit', 'layers:clear', 'active:false'])
  })
})

describe('disaster map integration helpers', () => {
  it('把实时与已打开历史映射为 controller snapshot', () => {
    const live = detail('live')
    const history = { ...detail('history'), status: 'stop' as const }
    const result = mapTyphoonLayerSnapshot({ realtimeDetails: [live], openedHistoricalIds: ['history'], details: { live, history }, focusedTyphoonId: 'live', selectedNodeByTyphoon: { live: 'node-1' }, visibleObservationCountByTyphoon: { history: 2 } })
    expect(result.realtime.map((entry) => entry.detail.id)).toEqual(['live'])
    expect(result.realtime[0]!.visibleObservationCount).toBeUndefined()
    expect(result.historical.map((entry) => entry.detail.id)).toEqual(['history'])
    expect(result.historical[0]!.visibleObservationCount).toBe(2)
    expect(result.focusedTyphoonId).toBe('live')
  })

  it('灾害模式、地块模式或程序化缩放均阻止自动行政进退', () => {
    expect(autoLevelAllowed(false, 'idle', false)).toBe(true)
    expect(autoLevelAllowed(true, 'idle', false)).toBe(false)
    expect(autoLevelAllowed(false, 'filter', false)).toBe(false)
    expect(autoLevelAllowed(false, 'idle', true)).toBe(false)
  })
})
