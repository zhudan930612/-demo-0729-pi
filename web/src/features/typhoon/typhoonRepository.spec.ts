import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { TyphoonApiClient } from '../../api/typhoon'
import { useTyphoonStore } from '../../stores/typhoon'
import { createTyphoonSessionRepository } from './typhoonRepository'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const listPayload = (items: Array<{ id: string; type: 'start' | 'stop' }>) => ({ code: 200, list: items.map((item) => ({ no1: item.id, type: item.type, namecn: item.id, nameen: item.id })) })
const detailPayload = (id: string, type: 'start' | 'stop', time: string) => ({ code: 200, no1: id, type, namecn: id, nameen: id, datas: [{ time_ymdh: time, lat: 20, lon: 120, wind_speed_ms: 20, wind_radius: [] }] })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('typhoon session repository', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('实时逐条提交且全部实时完成前不请求历史', async () => {
    const store = useTyphoonStore()
    const liveA = deferred<unknown>(), liveB = deferred<unknown>(), history = deferred<unknown>()
    const api: TyphoonApiClient = {
      list: vi.fn(async () => listPayload([{ id: 'a', type: 'start' }, { id: 'b', type: 'start' }, { id: 'h', type: 'stop' }])),
      detail: vi.fn((id: string) => ({ a: liveA.promise, b: liveB.promise, h: history.promise } as Record<string, Promise<unknown>>)[id]!),
    }
    const repository = createTyphoonSessionRepository(store, { api, now: () => Date.UTC(2026, 0, 1), liveConcurrency: 2 })
    const completed = repository.enter()
    await flush()
    expect(api.detail).toHaveBeenCalledTimes(2)
    liveA.resolve(detailPayload('a', 'start', '2026-01-01 01:00:00'))
    await flush()
    expect(store.details.a).toBeTruthy()
    expect(api.detail).toHaveBeenCalledTimes(2)
    liveB.resolve(detailPayload('b', 'start', '2026-01-01 02:00:00'))
    await flush()
    expect(store.phase).toBe('ready')
    expect(api.detail).toHaveBeenCalledTimes(3)
    history.resolve(detailPayload('h', 'stop', '2026-01-01 00:00:00'))
    await completed
    expect(store.details.h).toBeTruthy()
    expect(store.liveIds).toEqual(['b', 'a'])
    expect(store.focusedTyphoonId).toBe('b')
  })

  it('无实时也加载历史并保持实时空态', async () => {
    const store = useTyphoonStore()
    const api: TyphoonApiClient = { list: vi.fn(async () => listPayload([{ id: 'h', type: 'stop' }])), detail: vi.fn(async () => detailPayload('h', 'stop', '2026-01-01 00:00:00')) }
    await createTyphoonSessionRepository(store, { api, now: () => Date.UTC(2026, 0, 1) }).enter()
    expect(store.hasNoActiveTyphoon).toBe(true)
    expect(store.details.h).toBeTruthy()
    expect(store.openedHistoricalIds).toEqual([])
  })

  it('部分历史失败只计数并保留成功详情', async () => {
    const store = useTyphoonStore()
    const api: TyphoonApiClient = {
      list: vi.fn(async () => listPayload([{ id: 'h1', type: 'stop' }, { id: 'h2', type: 'stop' }])),
      detail: vi.fn(async (id) => id === 'h1' ? detailPayload('h1', 'stop', '2026-01-01 00:00:00') : Promise.reject(new Error('failed'))),
    }
    await createTyphoonSessionRepository(store, { api, now: () => Date.UTC(2026, 0, 1) }).enter()
    expect(store.historyLoad).toMatchObject({ succeeded: 1, failed: 1, pending: 0 })
    expect(Object.keys(store.details)).toEqual(['h1'])
  })

  it('退出 abort 且迟到响应不能写回', async () => {
    const store = useTyphoonStore()
    const list = deferred<unknown>()
    let signal: AbortSignal | undefined
    const api: TyphoonApiClient = { list: vi.fn((_year, nextSignal) => { signal = nextSignal; return list.promise }), detail: vi.fn() }
    const repository = createTyphoonSessionRepository(store, { api, now: () => Date.UTC(2026, 0, 1) })
    const completed = repository.enter()
    repository.exit()
    expect(signal?.aborted).toBe(true)
    list.resolve(listPayload([{ id: 'a', type: 'start' }]))
    await completed
    expect(store.phase).toBe('closed')
    expect(store.summaries).toEqual({})
  })

  it('同一会话重复 enter 不重复发请求', async () => {
    const store = useTyphoonStore()
    const list = deferred<unknown>()
    const api: TyphoonApiClient = { list: vi.fn(() => list.promise), detail: vi.fn() }
    const repository = createTyphoonSessionRepository(store, { api, now: () => Date.UTC(2026, 0, 1) })
    const first = repository.enter(), second = repository.enter()
    expect(api.list).toHaveBeenCalledTimes(1)
    list.resolve(listPayload([]))
    await Promise.all([first, second])
    expect(store.phase).toBe('ready')
  })

  it('实时详情失败显示错误占位且不写入伪详情', async () => {
    const store = useTyphoonStore()
    const api: TyphoonApiClient = { list: vi.fn(async () => listPayload([{ id: 'a', type: 'start' }])), detail: vi.fn(async () => { throw new Error('failed') }) }
    await createTyphoonSessionRepository(store, { api, now: () => Date.UTC(2026, 0, 1) }).enter()
    expect(store.phase).toBe('error')
    expect(store.errorMessage).toBe('实时台风数据加载异常')
    expect(store.details.a).toBeUndefined()
  })
})
