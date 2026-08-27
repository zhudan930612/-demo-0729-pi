/**
 * 受灾预警播放控制器（R2-1~R2-4 播放语义）。
 * - 按台风节点逐帧推进，默认 150ms/节点（与 typhoonPlaybackController 一致）；
 * - 进入即自动播放；**循环播放不自动停**（播到末节点回起点重播，R2-4）；
 * - 暂停停在当前节点；再播放继续（R2-4）；
 * - 循环回起点时触发 onLoopRestart（R5-7 演示状态全部重置的钩子）。
 * 与 typhoonPlaybackController 不同：它按 typhoon id 管理且不循环；本控制器专为
 * 受灾预警单轨迹循环播放设计，不依赖 Leaflet/台风 store，纯注入计时器可单测。
 */
export interface DisasterPlaybackCallbacks {
  /** 每推进一帧；nodeIndex 为该帧节点下标（0 基）。 */
  onStep(nodeIndex: number): void
  /** 从末节点回到起点（0）后回调；用于重置演示状态（R5-7）。 */
  onLoopRestart(nodeIndex: number): void
}

export interface DisasterPlaybackOptions {
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  intervalMs?: number
}

export interface DisasterPlaybackController {
  start(nodeCount: number, callbacks: DisasterPlaybackCallbacks): boolean
  pause(): void
  resume(): void
  isPlaying(): boolean
  destroy(): void
}

export function createDisasterPlaybackController(options: DisasterPlaybackOptions = {}): DisasterPlaybackController {
  const schedule = options.setTimeout ?? globalThis.setTimeout
  const unschedule = options.clearTimeout ?? globalThis.clearTimeout
  const intervalMs = options.intervalMs ?? 150
  let timer: ReturnType<typeof setTimeout> | null = null
  let playing = false
  let nodeIndex = 0
  let nodeCount = 0
  let callbacks: DisasterPlaybackCallbacks | null = null

  function advance() {
    if (!playing || !callbacks) return
    timer = null
    if (nodeCount <= 0) return
    nodeIndex += 1
    if (nodeIndex >= nodeCount) {
      // R2-4 循环：末节点 → 起点重播；R5-7 重置钩子
      nodeIndex = 0
      callbacks.onLoopRestart(nodeIndex)
    }
    callbacks.onStep(nodeIndex)
    if (playing) timer = schedule(advance, intervalMs)
  }

  return {
    start(count: number, cb: DisasterPlaybackCallbacks): boolean {
      if (count <= 0) return false
      nodeCount = count
      callbacks = cb
      nodeIndex = 0
      playing = true
      if (timer !== null) unschedule(timer)
      timer = schedule(advance, intervalMs)
      return true
    },
    pause() {
      playing = false
      if (timer !== null) { unschedule(timer); timer = null }
    },
    resume() {
      if (playing || nodeCount <= 0 || !callbacks) return
      playing = true
      if (timer !== null) unschedule(timer)
      timer = schedule(advance, intervalMs)
    },
    isPlaying() { return playing },
    destroy() {
      playing = false
      if (timer !== null) { unschedule(timer); timer = null }
      callbacks = null
      nodeCount = 0
    },
  }
}
