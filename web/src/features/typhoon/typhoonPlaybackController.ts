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

interface PlaybackEntry {
  timer: ReturnType<typeof setTimeout> | null
  token: number
}

/** 每个历史台风拥有独立计时器；打开或聚焦另一台风不停止已有播放。 */
export function createTyphoonPlaybackController(options: TyphoonPlaybackOptions = {}) {
  const schedule = options.setTimeout ?? globalThis.setTimeout
  const unschedule = options.clearTimeout ?? globalThis.clearTimeout
  const reducedMotion = options.reducedMotion ?? (() => false)
  const intervalMs = options.intervalMs ?? 150
  const entries = new Map<string, PlaybackEntry>()
  let nextToken = 0

  function cancel(typhoonId?: string) {
    if (typhoonId) {
      const entry = entries.get(typhoonId)
      if (!entry) return false
      if (entry.timer !== null) unschedule(entry.timer)
      entries.delete(typhoonId)
      return true
    }
    const cancelled = entries.size > 0
    for (const entry of entries.values()) if (entry.timer !== null) unschedule(entry.timer)
    entries.clear()
    return cancelled
  }

  function play(detail: TyphoonDetail, callbacks: TyphoonPlaybackCallbacks) {
    cancel(detail.id)
    const nodes = detail.observationsAsc
    if (!nodes.length) return false
    const entry: PlaybackEntry = { timer: null, token: ++nextToken }
    entries.set(detail.id, entry)

    if (reducedMotion()) {
      const last = nodes[nodes.length - 1]!
      callbacks.onStep(last, nodes.length)
      callbacks.onComplete(last, nodes.length)
      entries.delete(detail.id)
      return true
    }

    let visibleCount = 1
    callbacks.onStep(nodes[0]!, visibleCount)
    if (nodes.length === 1) {
      callbacks.onComplete(nodes[0]!, visibleCount)
      entries.delete(detail.id)
      return true
    }

    const advance = () => {
      const current = entries.get(detail.id)
      if (!current || current.token !== entry.token) return
      visibleCount += 1
      const node = nodes[visibleCount - 1]!
      callbacks.onStep(node, visibleCount)
      if (visibleCount >= nodes.length) {
        entries.delete(detail.id)
        callbacks.onComplete(node, visibleCount)
        return
      }
      current.timer = schedule(advance, intervalMs)
    }
    entry.timer = schedule(advance, intervalMs)
    return true
  }

  function destroy() { cancel() }

  return {
    play,
    cancel,
    destroy,
    isPlaying: (typhoonId: string) => entries.has(typhoonId),
    get activeTyphoonIds() { return [...entries.keys()] },
  }
}

export type TyphoonPlaybackController = ReturnType<typeof createTyphoonPlaybackController>
