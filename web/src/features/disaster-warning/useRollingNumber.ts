import { ref, watch, type Ref } from 'vue'

export interface RollingNumberOptions {
  /** 滚动动画时长 ms（默认 600） */
  duration?: number
  /** 是否启用（prefers-reduced-motion 或纯静态场景可关） */
  enabled?: () => boolean
  requestAnimationFrame?: typeof globalThis.requestAnimationFrame
  cancelAnimationFrame?: typeof globalThis.cancelAnimationFrame
}

/**
 * 数字滚动动效（R4-2：灾损预估数字随播放逐节点刷新，旧值滚动过渡到新值）。
 * - 目标值变化时从当前显示值插值滚动到新值（easeOutCubic）；
 * - 无 rAF 环境（SSR/测试）直接跳变；enabled=false（reduce-motion）直接跳变。
 */
export function useRollingNumber(target: Ref<number>, options: RollingNumberOptions = {}): Ref<number> {
  const duration = options.duration ?? 600
  const raf = options.requestAnimationFrame ?? globalThis.requestAnimationFrame
  const caf = options.cancelAnimationFrame ?? globalThis.cancelAnimationFrame
  const isEnabled = options.enabled ?? (() => true)
  const displayed = ref(0)
  let frame: number | null = null

  function stop() {
    if (frame !== null && caf) caf(frame)
    frame = null
  }

  function animate(from: number, to: number) {
    stop()
    if (!isEnabled() || !raf || !Number.isFinite(to) || Math.abs(to - from) < 1e-9) {
      displayed.value = to
      return
    }
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      displayed.value = from + (to - from) * eased
      if (t < 1) frame = raf(step)
      else displayed.value = to
    }
    frame = raf(step)
  }

  // 首次同步：初始值直接落定（不滚动）
  displayed.value = target.value
  // 目标值变化 → 滚动
  watch(target, (value) => {
    const from = displayed.value
    animate(from, value)
  })

  return displayed
}
