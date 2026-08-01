import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useDrilldownStore } from './drilldown'

beforeEach(() => setActivePinia(createPinia()))

describe('drilldown resetToProvince', () => {
  it('导航守卫拒绝时保留当前层级', async () => {
    const store = useDrilldownStore()
    store.path.push({ level: 'city', code: '330100', name: '杭州市' })
    store.setNavigationGuard(() => false)
    await expect(store.resetToProvince()).resolves.toBe(false)
    expect(store.current.level).toBe('city')
    store.setNavigationGuard(null)
  })

  it('导航守卫允许时回到浙江省', async () => {
    const store = useDrilldownStore()
    store.path.push({ level: 'city', code: '330100', name: '杭州市' })
    store.setNavigationGuard(() => true)
    await expect(store.resetToProvince()).resolves.toBe(true)
    expect(store.path).toEqual([{ level: 'province', code: '330000', name: '浙江省' }])
    store.setNavigationGuard(null)
  })

  it('已经在省级时仍返回成功且不调用守卫', async () => {
    const store = useDrilldownStore()
    let called = 0
    store.setNavigationGuard(() => { called += 1; return false })
    await expect(store.resetToProvince()).resolves.toBe(true)
    expect(called).toBe(0)
    store.setNavigationGuard(null)
  })
})
