import type { ObservationNode, TyphoonDetail } from './typhoonTypes'

export interface TyphoonPlaybackCallbacks {
  onStep(node: ObservationNode, visibleCount: number): void
  onComplete(node: ObservationNode, visibleCount: number): void
}

export interface TyphoonPlaybackOptions {
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
  reducedMotion?: () => boolean
  intervalMs?: number
}

/** 单一逐点动画 owner；任一时刻最多播放一条历史台风。 */
export function createTyphoonPlaybackController(options: TyphoonPlaybackOptions = {}) {
  const schedule = options.setTimeout ?? globalThis.setTimeout
  const unschedule = options.clearTimeout ?? globalThis.clearTimeout
  const reducedMotion = options.reducedMotion ?? (() => false)
  const intervalMs = options.intervalMs ?? 300
  let timer: ReturnType<typeof setTimeout> | null = null
  let token = 0
  let activeTyphoonId: string | null = null

  function cancel(typhoonId?: string) {
    if (typhoonId && activeTyphoonId !== typhoonId) return false
    token += 1
    if (timer !== null) unschedule(timer)
    timer = null
    const cancelled = activeTyphoonId !== null
    activeTyphoonId = null
    return cancelled
  }

  function play(detail: TyphoonDetail, callbacks: TyphoonPlaybackCallbacks) {
    cancel()
    const nodes = detail.observationsAsc
    if (!nodes.length) return false
    activeTyphoonId = detail.id
    const playToken = token

    if (reducedMotion()) {
      const last = nodes[nodes.length - 1]!
      callbacks.onStep(last, nodes.length)
      callbacks.onComplete(last, nodes.length)
      activeTyphoonId = null
      return true
    }

    let visibleCount = 1
    callbacks.onStep(nodes[0]!, visibleCount)
    if (nodes.length === 1) {
      callbacks.onComplete(nodes[0]!, visibleCount)
      activeTyphoonId = null
      return true
    }

    const advance = () => {
      if (playToken !== token || activeTyphoonId !== detail.id) return
      visibleCount += 1
      const node = nodes[visibleCount - 1]!
      callbacks.onStep(node, visibleCount)
      if (visibleCount >= nodes.length) {
        timer = null
        activeTyphoonId = null
        callbacks.onComplete(node, visibleCount)
        return
      }
      timer = schedule(advance, intervalMs)
    }
    timer = schedule(advance, intervalMs)
    return true
  }

  function destroy() { cancel() }

  return {
    play,
    cancel,
    destroy,
    get activeTyphoonId() { return activeTyphoonId },
  }
}

export type TyphoonPlaybackController = ReturnType<typeof createTyphoonPlaybackController>
