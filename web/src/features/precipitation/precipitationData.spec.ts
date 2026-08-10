import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isPrecipitationSnapshot } from '../../api/precipitation'
import { precipitationLevel } from './precipitationTypes'
import type { PrecipitationSnapshot } from './precipitationTypes'
import { PRECIP_DAY_COUNT, PRECIP_DEFAULT_OPACITY, usePrecipitationStore } from '../../stores/precipitation'

function makeSnapshot(overrides: Partial<PrecipitationSnapshot> = {}): PrecipitationSnapshot {
  const grid = []
  for (let lat = 27.0; lat <= 31.5 + 1e-9; lat += 0.25) {
    for (let lon = 118.0; lon <= 123.0 + 1e-9; lon += 0.25) {
      grid.push({
        lat: Math.round(lat * 1000) / 1000,
        lon: Math.round(lon * 1000) / 1000,
        values: { d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0 },
      })
    }
  }
  return {
    grid, days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
    coveredDays: 7, model: 'ECMWF IFS 0.25°', updatedAt: '2026-08-10 08:12:00+08:00', aggregateFrom: '2026-08-10 09:00:00+08:00', ...overrides,
  }
}

describe('precipitationLevel 分级', () => {
  it('按中国气象局 24h 雨量等级返回分级文案', () => {
    expect(precipitationLevel(0)).toBe('无雨')
    expect(precipitationLevel(0.05)).toBe('无雨')
    expect(precipitationLevel(5)).toBe('小雨')
    expect(precipitationLevel(20)).toBe('中雨')
    expect(precipitationLevel(40)).toBe('大雨')
    expect(precipitationLevel(80)).toBe('暴雨')
    expect(precipitationLevel(200)).toBe('大暴雨')
    expect(precipitationLevel(300)).toBe('特大暴雨')
  })
  it('分级边界精确（10/25/50/100/250）', () => {
    expect(precipitationLevel(10)).toBe('中雨')
    expect(precipitationLevel(25)).toBe('大雨')
    expect(precipitationLevel(50)).toBe('暴雨')
    expect(precipitationLevel(100)).toBe('大暴雨')
    expect(precipitationLevel(250)).toBe('特大暴雨')
  })
})

describe('isPrecipitationSnapshot 校验', () => {
  it('合法快照通过（399 点 × 7 天完整）', () => {
    expect(isPrecipitationSnapshot(makeSnapshot())).toBe(true)
  })
  it('grid 缺 d1..d7 任一时段、days 数量不对、字段缺失均拒绝', () => {
    const broken = makeSnapshot()
    broken.grid = broken.grid.map((point) => ({ ...point, values: { d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0 } })) as unknown as PrecipitationSnapshot['grid']
    expect(isPrecipitationSnapshot(broken)).toBe(false)
    expect(isPrecipitationSnapshot(makeSnapshot({ days: ['2026-08-10'] }))).toBe(false)
    expect(isPrecipitationSnapshot({ ...makeSnapshot(), model: undefined })).toBe(false)
    expect(isPrecipitationSnapshot({ not: 'snapshot' })).toBe(false)
  })
  it('stale/refreshError 为可选字段', () => {
    expect(isPrecipitationSnapshot(makeSnapshot({ stale: true, refreshError: '失败' }))).toBe(true)
  })
})

describe('precipitation store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('open→receive 进入 ready，默认选中第 1 天、不透明度 60%', () => {
    const store = usePrecipitationStore()
    store.open()
    expect(store.phase).toBe('loading')
    const g = store.generation
    expect(store.receive(g, makeSnapshot())).toBe(true)
    expect(store.phase).toBe('ready')
    expect(store.selectedDay).toBe(0)
    expect(store.opacity).toBe(PRECIP_DEFAULT_OPACITY)
    expect(store.days).toHaveLength(PRECIP_DAY_COUNT)
  })
  it('过期 generation 的 receive/fail 被拒绝', () => {
    const store = usePrecipitationStore()
    store.open()
    const g = store.generation
    store.open() // 重新进入，generation+1
    expect(store.receive(g, makeSnapshot())).toBe(false)
    expect(store.fail(g, 'x')).toBe(false)
  })
  it('fail 无快照→error，有快照→保留 ready 并记录错误信息', () => {
    const store = usePrecipitationStore()
    store.open()
    const g = store.generation
    store.fail(g, '上游失败')
    expect(store.phase).toBe('error')
    expect(store.errorMessage).toBe('上游失败')
    store.receive(g, makeSnapshot())
    store.fail(g, '刷新失败')
    expect(store.phase).toBe('ready')
    expect(store.errorMessage).toBe('刷新失败')
  })
  it('selectDay 暂停播放并跳转，越界忽略', () => {
    const store = usePrecipitationStore()
    store.open(); store.receive(store.generation, makeSnapshot())
    store.startPlay()
    store.selectDay(3)
    expect(store.selectedDay).toBe(3)
    expect(store.playing).toBe(false)
    expect(store.timer).toBeNull() // 播放中点日期必须清除计时器（防残留推进）
    store.selectDay(99)
    expect(store.selectedDay).toBe(3)
    store.selectDay(-1)
    expect(store.selectedDay).toBe(3)
  })
  it('播放中点日期暂停并跳转；再次播放从当前日期继续', () => {
    const store = usePrecipitationStore()
    store.open(); store.receive(store.generation, makeSnapshot())
    let tick: (() => void) | null = null
    const fakeSet = ((callback: () => void) => { tick = callback; return 1 }) as unknown as typeof setInterval
    store.startPlay({ setInterval: fakeSet, clearInterval: vi.fn() })
    tick!()
    expect(store.selectedDay).toBe(1)
    // 播放中点击日期 → 暂停并跳转
    store.selectDay(4)
    expect(store.selectedDay).toBe(4)
    expect(store.playing).toBe(false)
    expect(store.timer).toBeNull()
    // 再次播放 → 从当前日期（4）继续
    store.startPlay({ setInterval: fakeSet, clearInterval: vi.fn() })
    tick!()
    expect(store.selectedDay).toBe(5)
    tick!()
    expect(store.selectedDay).toBe(6)
  })
  it('循环播放：到第 7 天后回第 1 天继续，无自动停止', () => {
    const store = usePrecipitationStore()
    store.open(); store.receive(store.generation, makeSnapshot())
    let tick: (() => void) | null = null
    const fakeSet = ((callback: () => void) => { tick = callback; return 1 }) as unknown as typeof setInterval
    store.startPlay({ setInterval: fakeSet, clearInterval: vi.fn() })
    expect(store.playing).toBe(true)
    store.selectedDay = PRECIP_DAY_COUNT - 1 // 播到第 7 天
    tick!()
    expect(store.selectedDay).toBe(0) // 循环回第 1 天
    tick!()
    expect(store.selectedDay).toBe(1) // 继续播放
  })
  it('stopPlay/close 清除计时器', () => {
    const store = usePrecipitationStore()
    store.open(); store.receive(store.generation, makeSnapshot())
    const clear = vi.fn()
    store.startPlay({ setInterval: ((() => 42) as unknown as typeof setInterval), clearInterval: clear })
    store.stopPlay({ clearInterval: clear })
    expect(clear).toHaveBeenCalledWith(42)
    expect(store.playing).toBe(false)
    store.startPlay()
    store.close()
    expect(store.phase).toBe('closed')
    expect(store.playing).toBe(false)
  })
  it('setOpacity 限幅 0–1，非法值忽略', () => {
    const store = usePrecipitationStore()
    store.setOpacity(0.2)
    expect(store.opacity).toBe(0.2)
    store.setOpacity(5)
    expect(store.opacity).toBe(1)
    store.setOpacity(-1)
    expect(store.opacity).toBe(0)
    store.setOpacity(Number.NaN)
    expect(store.opacity).toBe(0)
  })
})

describe('api 错误映射', () => {
  it('非 2xx 抛出 PrecipitationApiError 携带 code/status', async () => {
    const response = new Response(JSON.stringify({ error: { code: 'PRECIP_UNAVAILABLE', message: '降水预报数据暂不可用' } }), { status: 502 })
    const client = (await import('../../api/precipitation')).createPrecipitationApiClient((async () => response) as typeof fetch)
    await expect(client.snapshot()).rejects.toMatchObject({ code: 'PRECIP_UNAVAILABLE', status: 502 })
  })
  it('响应结构异常抛出 INVALID_RESPONSE', async () => {
    const response = new Response(JSON.stringify({ nope: 1 }), { status: 200 })
    const client = (await import('../../api/precipitation')).createPrecipitationApiClient((async () => response) as typeof fetch)
    await expect(client.snapshot()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
