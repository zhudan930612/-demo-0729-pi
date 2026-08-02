import { describe, expect, it, vi } from 'vitest'
import { autoLevelAllowed, createDisasterModeCoordinator, mapTyphoonLayerSnapshot, shouldAutoFitTyphoon } from './disasterModeLifecycle'
import type { TyphoonDetail } from './typhoonTypes'

function ports(overrides: Record<string, unknown> = {}) {
  let active = false
  const events: string[] = []
  return {
    events,
    value: {
      hasUnsavedWork: () => false, isActive: () => active,
      setActive: (value: boolean) => { active = value; events.push(`active:${value}`) },
      closeBusinessPanels: () => events.push('close'), hideParcelLayers: () => events.push('hide'),
      resetToProvince: async () => true, prepareProvinceLayers: async () => {}, enterRepository: () => events.push('repository'),
      rollback: () => { active = false; events.push('rollback') },
      ...overrides,
    },
    activate() { active = true },
  }
}

describe('disaster mode generation coordinator', () => {
  it('进入中退出后旧任务不能启动 repository', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => { resolve = done })
    const setup = ports({ prepareProvinceLayers: () => pending })
    const coordinator = createDisasterModeCoordinator()
    const entering = coordinator.enter(setup.value)
    await Promise.resolve(); await Promise.resolve()
    coordinator.exit({ isActive: setup.value.isActive, setActive: setup.value.setActive, exitRepository: vi.fn(), clearTyphoonLayers: vi.fn(), invalidateNavigation: vi.fn() })
    resolve()
    await expect(entering).resolves.toBe(false)
    expect(setup.events).not.toContain('repository')
  })

  it('退出立即重进时第一轮不能借新 active 复活', async () => {
    let resolveFirst!: () => void
    const first = ports({ prepareProvinceLayers: () => new Promise<void>((done) => { resolveFirst = done }) })
    const coordinator = createDisasterModeCoordinator()
    const oldEnter = coordinator.enter(first.value)
    await Promise.resolve(); await Promise.resolve()
    coordinator.exit({ isActive: first.value.isActive, setActive: first.value.setActive, exitRepository: vi.fn(), clearTyphoonLayers: vi.fn(), invalidateNavigation: vi.fn() })
    const next = ports()
    await expect(coordinator.enter(next.value)).resolves.toBe(true)
    resolveFirst()
    await expect(oldEnter).resolves.toBe(false)
    expect(first.events).not.toContain('repository')
    expect(next.events).toContain('repository')
  })

  it('reset false 与 panorama reject 均回滚', async () => {
    const coordinator = createDisasterModeCoordinator()
    const rejectedReset = ports({ resetToProvince: async () => false })
    await expect(coordinator.enter(rejectedReset.value)).resolves.toBe(false)
    expect(rejectedReset.events).toContain('rollback')
    const rejectedRender = ports({ prepareProvinceLayers: async () => { throw new Error('render') } })
    await expect(coordinator.enter(rejectedRender.value)).resolves.toBe(false)
    expect(rejectedRender.events).toContain('rollback')
  })
})

describe('integration helpers', () => {
  const detail = (id: string): TyphoonDetail => ({ id, nameCn:id, nameEn:id, status:'start', sourceIndex:0, observationsApiOrder:[], observationsAsc:[], observationsDesc:[], latestObservation:null, anomalies:[] })
  it('映射图层快照并阻止灾害态自动下钻', () => {
    const live = detail('live')
    expect(mapTyphoonLayerSnapshot({ realtimeDetails:[live], openedHistoricalIds:[], details:{ live }, focusedTyphoonId:'live', selectedNodeByTyphoon:{} }).realtime[0]?.detail.id).toBe('live')
    expect(autoLevelAllowed(true, 'idle', false)).toBe(false)
  })
  it('自动 fit 仅在 ready 且最终焦点为实时台风时消费', () => {
    const base = { active:true, phase:'ready', focusedId:'a', realtimeIds:['a'], sessionId:2, fittedSessionId:null }
    expect(shouldAutoFitTyphoon(base)).toBe(true)
    expect(shouldAutoFitTyphoon({ ...base, phase:'loading-live' })).toBe(false)
    expect(shouldAutoFitTyphoon({ ...base, focusedId:'history' })).toBe(false)
    expect(shouldAutoFitTyphoon({ ...base, fittedSessionId:2 })).toBe(false)
  })
})
