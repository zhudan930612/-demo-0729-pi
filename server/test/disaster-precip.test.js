import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDisasterPrecipService, buildDisasterGrid, DISASTER_WINDOW, UPSTREAM_URL, DisasterPrecipError } from '../src/disaster-precip-service.js'

function makeItem(lat, lon, hours = 120, value = 1) {
  const times = Array.from({ length: hours }, (_, i) => {
    const d = new Date(Date.UTC(2026, 6, 9) + i * 3600 * 1000)
    return d.toISOString().replace('T', ' ').slice(0, 19)
  })
  return { latitude: lat, longitude: lon, hourly: { time: times, precipitation: Array.from({ length: hours }, () => value) } }
}

test('网格构建：浙江 0.25° 21×19=399 请求点', () => {
  const g = buildDisasterGrid()
  assert.equal(g.pointCount, 399)
  assert.equal(g.lons.length, 21)
  assert.equal(g.lats.length, 19)
  assert.equal(g.lons[0], 118.0)
  assert.equal(g.lons[20], 123.0)
  assert.equal(g.lats[0], 27.0)
  assert.equal(g.lats[18], 31.5)
})

test('快照：分块拉取 → 按吸附 lat/lon 去重 → 返回逐小时网格', async () => {
  const seenUrls = []
  const service = createDisasterPrecipService({}, {
    fetchImpl: async (url) => {
      seenUrls.push(url)
      const u = new URL(url)
      const lats = u.searchParams.get('latitude').split(',')
      const lons = u.searchParams.get('longitude').split(',')
      // 模拟 ERA5 吸附：吸附坐标 = 请求纬度 + 0.001（round3 后每请求点唯一）
      const items = lats.map((la, i) => makeItem(parseFloat(la) + 0.001, 118.0 + i * 0.25))
      return Response.json(items)
    },
  })
  const snap = await service.snapshot(null)
  assert.ok(snap.grid.length >= 398, `去重后网格数 ${snap.grid.length}`)
  assert.ok(snap.grid.length < 400)
  assert.equal(snap.hours, 120)
  assert.equal(snap.start, DISASTER_WINDOW.start)
  assert.equal(snap.end, DISASTER_WINDOW.end)
  // 分块：399 请求点 / 50 = 8 块
  assert.equal(seenUrls.length, 8)
  assert.ok(seenUrls[0].startsWith(UPSTREAM_URL))
  assert.ok(seenUrls[0].includes('start_date=2026-07-09'))
  assert.ok(seenUrls[0].includes('end_date=2026-07-13'))
  assert.ok(seenUrls[0].includes('timezone=Asia%2FShanghai'))
})

test('超时：上游不响应时按 abort 报 timeout', async () => {
  const service = createDisasterPrecipService({}, {
    fetchImpl: async (_url, { signal }) => {
      // 模拟真实 fetch：收到 abort 信号后以 AbortError 拒绝
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
      return Response.json([])
    },
  })
  const controller = new AbortController()
  setTimeout(() => controller.abort(), 30)
  await assert.rejects(() => service.snapshot(controller.signal), (err) => {
    assert.ok(err instanceof DisasterPrecipError)
    assert.equal(err.kind, 'aborted')
    return true
  })
})

test('响应过大：超过字节上限抛 too-large', async () => {
  const service = createDisasterPrecipService({}, {
    fetchImpl: async () => new Response('x'.repeat(70 * 1024 * 1024), { status: 200 }),
  })
  await assert.rejects(() => service.snapshot(null), (err) => {
    assert.ok(err instanceof DisasterPrecipError)
    assert.equal(err.kind, 'too-large')
    return true
  })
})

test('上游 429 报 http 错误', async () => {
  const service = createDisasterPrecipService({}, {
    fetchImpl: async () => new Response('busy', { status: 429 }),
  })
  await assert.rejects(() => service.snapshot(null), (err) => {
    assert.ok(err instanceof DisasterPrecipError)
    assert.equal(err.kind, 'http')
    assert.equal(err.status, 429)
    return true
  })
})
