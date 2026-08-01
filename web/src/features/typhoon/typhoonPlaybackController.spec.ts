import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTyphoonPlaybackController } from './typhoonPlaybackController'
import type { ObservationNode, TyphoonDetail } from './typhoonTypes'

function detail(count = 3): TyphoonDetail {
  const nodes: ObservationNode[] = Array.from({ length: count }, (_, index) => ({
    id: `history:obs:${index}`, sourceIndex: index, timeYmdh: `2026-01-0${index + 1} 00:00:00`, epochMs: index,
    lat: 20 + index, lon: 120 + index, windSpeedMs: 20, windRadii: [], forecastSnapshot: null,
  }))
  return { id: 'history', nameCn: '历史', nameEn: 'HISTORY', status: 'stop', sourceIndex: 0, observationsApiOrder: nodes, observationsAsc: nodes, observationsDesc: [...nodes].reverse(), latestObservation: nodes.at(-1) ?? null, anomalies: [] }
}

describe('typhoon playback controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('首点立即显示，之后每 300ms 只新增一个节点并在末点完成', () => {
    const steps: Array<[string, number]> = []
    const complete = vi.fn()
    const controller = createTyphoonPlaybackController()
    controller.play(detail(), { onStep: (node, count) => steps.push([node.id, count]), onComplete: complete })
    expect(steps).toEqual([['history:obs:0', 1]])
    vi.advanceTimersByTime(299)
    expect(steps).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(steps.at(-1)).toEqual(['history:obs:1', 2])
    vi.advanceTimersByTime(300)
    expect(steps.at(-1)).toEqual(['history:obs:2', 3])
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ id: 'history:obs:2' }), 3)
    expect(controller.activeTyphoonId).toBeNull()
  })

  it('取消后排队回调不再写入', () => {
    const onStep = vi.fn()
    const onComplete = vi.fn()
    const controller = createTyphoonPlaybackController()
    controller.play(detail(), { onStep, onComplete })
    controller.cancel()
    vi.runAllTimers()
    expect(onStep).toHaveBeenCalledTimes(1)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('减少动态效果时直接显示完整路径和末节点', () => {
    const onStep = vi.fn()
    const onComplete = vi.fn()
    const controller = createTyphoonPlaybackController({ reducedMotion: () => true })
    controller.play(detail(), { onStep, onComplete })
    expect(onStep).toHaveBeenCalledOnce()
    expect(onStep).toHaveBeenCalledWith(expect.objectContaining({ id: 'history:obs:2' }), 3)
    expect(onComplete).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('播放另一台风会取消前一个 timer', () => {
    const firstStep = vi.fn()
    const secondStep = vi.fn()
    const controller = createTyphoonPlaybackController()
    controller.play(detail(), { onStep: firstStep, onComplete: vi.fn() })
    const nextNodes = detail(2).observationsAsc.map((node, index) => ({ ...node, id: `next:obs:${index}` }))
    const next = { ...detail(2), id: 'next', observationsApiOrder: nextNodes, observationsAsc: nextNodes, observationsDesc: [...nextNodes].reverse(), latestObservation: nextNodes.at(-1) ?? null }
    controller.play(next, { onStep: secondStep, onComplete: vi.fn() })
    vi.runAllTimers()
    expect(firstStep).toHaveBeenCalledTimes(1)
    expect(secondStep).toHaveBeenCalledTimes(2)
  })
})
