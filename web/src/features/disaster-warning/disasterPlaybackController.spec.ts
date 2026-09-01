import { describe, expect, it, vi } from 'vitest'
import { createDisasterPlaybackController } from './disasterPlaybackController'

function fakeTimers() {
  const now = 0
  const queue = new Map<number, () => void>()
  let nextId = 1
  const setTimeoutImpl = vi.fn((fn: () => void, _ms: number) => {
    const id = nextId++
    queue.set(id, fn)
    return id
  })
  const clearTimeoutImpl = vi.fn((id: number | null | undefined) => {
    if (id === null || id === undefined) return
    queue.delete(id)
  })
  const tick = (count: number) => { for (let i = 0; i < count; i++) { const fn = [...queue.values()].shift(); if (!fn) break; queue.delete([...queue.keys()][0]!); fn() } }
  return { setTimeoutImpl, clearTimeoutImpl, tick, queue, get now() { return now } }
}

describe('createDisasterPlaybackController · 受灾预警播放语义（R2-1~R2-4）', () => {
  it('start 后自动推进：每个 intervalMs 前进一帧（R2-3 进入即自动播放，150ms/节点）', () => {
    const { setTimeoutImpl, clearTimeoutImpl, tick } = fakeTimers()
    const ctl = createDisasterPlaybackController({ setTimeout: setTimeoutImpl as unknown as typeof setTimeout, clearTimeout: clearTimeoutImpl as unknown as typeof clearTimeout, intervalMs: 150 })
    const steps: number[] = []
    expect(ctl.start(3, { onStep: (i) => steps.push(i), onLoopRestart: () => {} })).toBe(true)
    expect(ctl.isPlaying()).toBe(true)
    tick(1)
    expect(steps).toEqual([1])
    tick(1)
    expect(steps).toEqual([1, 2])
  })

  it('start 支持从指定节点开始播放（R2-6b）', () => {
    const { setTimeoutImpl, clearTimeoutImpl, tick } = fakeTimers()
    const ctl = createDisasterPlaybackController({ setTimeout: setTimeoutImpl as unknown as typeof setTimeout, clearTimeout: clearTimeoutImpl as unknown as typeof clearTimeout, intervalMs: 150 })
    const steps: number[] = []
    // 从节点 2 开始：第一步推进到 3
    expect(ctl.start(5, { onStep: (i) => steps.push(i), onLoopRestart: () => {} }, 2)).toBe(true)
    tick(1)
    expect(steps).toEqual([3])
    tick(1)
    expect(steps).toEqual([3, 4])
  })

  it('所有节点均使用同一播放间隔，不因风险状态加速', () => {
    const { setTimeoutImpl, clearTimeoutImpl, tick } = fakeTimers()
    const ctl = createDisasterPlaybackController({
      setTimeout: setTimeoutImpl as unknown as typeof setTimeout,
      clearTimeout: clearTimeoutImpl as unknown as typeof clearTimeout,
      intervalMs: 1000,
      intervalForNode: (nodeIndex: number) => nodeIndex >= 2 && nodeIndex <= 3 ? 1000 : 250,
    } as any)
    ctl.start(5, { onStep: () => {}, onLoopRestart: () => {} })
    expect(setTimeoutImpl).toHaveBeenLastCalledWith(expect.any(Function), 1000)
    tick(1)
    expect(setTimeoutImpl).toHaveBeenLastCalledWith(expect.any(Function), 1000)
    tick(1)
    expect(setTimeoutImpl).toHaveBeenLastCalledWith(expect.any(Function), 1000)
    tick(1)
    expect(setTimeoutImpl).toHaveBeenLastCalledWith(expect.any(Function), 1000)
  })

  it('播到末节点自动回起点循环，不自动停止（R2-4）', () => {
    const { setTimeoutImpl, clearTimeoutImpl, tick } = fakeTimers()
    const ctl = createDisasterPlaybackController({ setTimeout: setTimeoutImpl as unknown as typeof setTimeout, clearTimeout: clearTimeoutImpl as unknown as typeof clearTimeout, intervalMs: 150 })
    const steps: number[] = []
    const loops: number[] = []
    ctl.start(3, { onStep: (i) => steps.push(i), onLoopRestart: (i) => loops.push(i) })
    tick(3) // 0→1→2→3: steps [1,2,0], loop 0
    expect(steps).toEqual([1, 2, 0])
    expect(loops).toEqual([0])
    expect(ctl.isPlaying()).toBe(true) // 未停止，继续循环
    tick(1) // 0→1
    expect(steps).toEqual([1, 2, 0, 1])
  })

  it('暂停停在当前节点，再播放继续（R2-4）', () => {
    const { setTimeoutImpl, clearTimeoutImpl, tick } = fakeTimers()
    const ctl = createDisasterPlaybackController({ setTimeout: setTimeoutImpl as unknown as typeof setTimeout, clearTimeout: clearTimeoutImpl as unknown as typeof clearTimeout, intervalMs: 150 })
    const steps: number[] = []
    ctl.start(5, { onStep: (i) => steps.push(i), onLoopRestart: () => {} })
    tick(1)
    expect(steps).toEqual([1])
    ctl.pause()
    expect(ctl.isPlaying()).toBe(false)
    tick(3)
    expect(steps).toEqual([1]) // 暂停期间不推进
    ctl.resume()
    tick(1)
    expect(steps).toEqual([1, 2])
  })

  it('destroy 停止播放并清空回调', () => {
    const { setTimeoutImpl, clearTimeoutImpl, tick } = fakeTimers()
    const ctl = createDisasterPlaybackController({ setTimeout: setTimeoutImpl as unknown as typeof setTimeout, clearTimeout: clearTimeoutImpl as unknown as typeof clearTimeout, intervalMs: 150 })
    const steps: number[] = []
    ctl.start(2, { onStep: (i) => steps.push(i), onLoopRestart: () => {} })
    ctl.destroy()
    expect(ctl.isPlaying()).toBe(false)
    tick(5)
    expect(steps).toEqual([])
  })

  it('start 拒绝空节点序列', () => {
    const ctl = createDisasterPlaybackController()
    expect(ctl.start(0, { onStep: () => {}, onLoopRestart: () => {} })).toBe(false)
  })
})
