import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useRollingNumber } from './useRollingNumber'

function fakeRaf() {
  let rafId = 0
  const queue = new Map<number, (now: number) => void>()
  const raf = vi.fn((cb: (now: number) => void) => { const id = ++rafId; queue.set(id, cb); return id })
  const caf = vi.fn((id: number) => { queue.delete(id) })
  const tick = (count = 1, stepMs = 120) => {
    const base = performance.now()
    for (let i = 0; i < count; i++) {
      const entries = [...queue.entries()]
      if (entries.length === 0) break
      for (const [id, cb] of entries) { queue.delete(id); cb(base + (i + 1) * stepMs) }
    }
  }
  return { raf, caf, tick, queue }
}

describe('useRollingNumber · 灾损数字滚动动效（R4-2）', () => {
  it('目标值变化时从旧值插值滚动到新值（easeOut，终值一致）', async () => {
    const { raf, caf, tick } = fakeRaf()
    const target = ref(0)
    const displayed = useRollingNumber(target, { duration: 600, requestAnimationFrame: raf as never, cancelAnimationFrame: caf as never })
    expect(displayed.value).toBe(0)
    target.value = 100
    await nextTick() // 触发 watch 回调
    expect(raf).toHaveBeenCalled()
    tick(5, 120) // 推进 600ms
    expect(displayed.value).toBe(100)
  })

  it('目标值不变时不触发动画', async () => {
    const { raf, caf } = fakeRaf()
    const target = ref(42)
    const displayed = useRollingNumber(target, { duration: 300, requestAnimationFrame: raf as never, cancelAnimationFrame: caf as never })
    expect(displayed.value).toBe(42)
    await nextTick()
    expect(raf).not.toHaveBeenCalled()
  })

  it('无 rAF 环境（测试/SSR）直接跳变到目标值', async () => {
    const target = ref(0)
    const displayed = useRollingNumber(target, { requestAnimationFrame: undefined as never, cancelAnimationFrame: undefined as never })
    target.value = 7
    await nextTick()
    expect(displayed.value).toBe(7)
  })

  it('disabled（reduce-motion）直接跳变不滚动', async () => {
    const { raf, caf } = fakeRaf()
    const target = ref(0)
    const displayed = useRollingNumber(target, { enabled: () => false, requestAnimationFrame: raf as never, cancelAnimationFrame: caf as never })
    target.value = 88
    await nextTick()
    expect(displayed.value).toBe(88)
    expect(raf).not.toHaveBeenCalled()
  })
})
