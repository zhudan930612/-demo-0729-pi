import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPrecipitationService, buildGridPoints, aggregateDaily, PRECIP_DAYS, PRECIP_FORECAST_HOURS, PRECIP_TTL_MS, PrecipitationError } from '../src/precipitation-service.js'

const T0 = Date.UTC(2026, 7, 10, 0, 30, 0) // 北京时间 2026-08-10 08:30

function makePayload({ hours = PRECIP_FORECAST_HOURS, value = 1, points = null } = {}) {
  const grid = buildGridPoints()
  // 真实小时粒度：从 2026-08-10 00:00 起逐小时（i 小时偏移）
  const times = Array.from({ length: hours }, (_, i) => new Date(Date.UTC(2026, 7, 10) + i * 3600 * 1000).toISOString().slice(0, 19))
  const items = []
  for (let lat of grid.lats) for (let lon of grid.lons) {
    items.push({ latitude: lat, longitude: lon, hourly: { time: times, precipitation: Array.from({ length: hours }, () => value) } })
  }
  if (points !== null) items.length = points
  return items
}

test('grid 构建：浙江 0.25° 矩形 21×19=399 点，坐标串按索引配对', () => {
  const grid = buildGridPoints()
  assert.equal(grid.pointCount, 399)
  assert.equal(grid.lons.length, 21); assert.equal(grid.lats.length, 19)
  assert.equal(grid.lons[0], 118.0); assert.equal(grid.lons[20], 123.0)
  assert.equal(grid.lats[0], 27.0); assert.equal(grid.lats[18], 31.5)
  const latParts = grid.latParam.split(',')
  const lonParts = grid.lonParam.split(',')
  assert.equal(latParts.length, 399); assert.equal(lonParts.length, 399)
  assert.equal(latParts[0], '27'); assert.equal(lonParts[0], '118')
  assert.equal(latParts[1], '27'); assert.equal(lonParts[1], '118.25')
})

test('aggregateDaily：从起点起每 24 小时一段求和，段内 null 跳过', () => {
  const hours = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? null : 0.5))
  const values = {}
  const covered = aggregateDaily(values, hours, 9)
  assert.equal(covered, PRECIP_DAYS)
  // 每段 24 个值，null 占 8 个，实取 16 × 0.5 = 8
  assert.equal(values.d1, 8); assert.equal(values.d7, 8)
  assert.equal(Object.keys(values).length, PRECIP_DAYS)
})

test('aggregateDaily：序列不足时按实际可得求和、不补 0，并返回实际覆盖天数', () => {
  const values = {}
  const hours = Array.from({ length: 100 }, () => 1)
  const covered = aggregateDaily(values, hours, 0)
  assert.equal(covered, 5) // 前 4 段完整 24，第 5 段 from=96 仅剩 96-99 共 4 个 → 按实得求和仍算覆盖
  assert.equal(values.d5, 4)
  assert.equal('d6' in values, false)
  const empty = {}
  assert.equal(aggregateDaily(empty, hours, 500), 0)
})

test('服务快照：拉取→归一化→7 段聚合，参数固定（浏览器不可改）', async () => {
  let seenUrl = null
  const service = createPrecipitationService({}, {
    now: () => T0,
    fetchImpl: async (url) => { seenUrl = url; return Response.json(makePayload()) },
  })
  const snapshot = await service.snapshot(null)
  assert.ok(seenUrl.includes('forecast_hours=192'))
  assert.ok(seenUrl.includes('hourly=precipitation'))
  assert.ok(seenUrl.includes('timezone=Asia%2FShanghai'))
  assert.ok(seenUrl.includes('models=ecmwf_ifs025'))
  assert.ok(seenUrl.includes('latitude=') && seenUrl.includes('longitude='))
  assert.equal(snapshot.grid.length, 399)
  assert.equal(snapshot.days.length, PRECIP_DAYS)
  assert.equal(snapshot.days[0], '2026-08-10')
  assert.equal(snapshot.model, 'ECMWF IFS 0.25°')
  assert.equal(snapshot.coveredDays, 7)
  assert.equal(snapshot.aggregateFrom, '2026-08-10 00:00:00+08:00') // 自然日累计：今日 0 点起
  // T0 北京 08:30 → 起点今日 0:00，值全 1 → 每段 24
  assert.equal(snapshot.grid[0].values.d1, 24)
  assert.equal(snapshot.grid[0].values.d7, 24)
})

test('时间格式契约：updatedAt/aggregateFrom 为北京时间 +08:00，无 UTC Z 输出', async () => {
  const service = createPrecipitationService({}, { now: () => T0, fetchImpl: async () => Response.json(makePayload()) })
  const snapshot = await service.snapshot(null)
  assert.equal(snapshot.updatedAt, '2026-08-10 08:30:00+08:00')
  assert.ok(snapshot.updatedAt.endsWith('+08:00'))
  assert.ok(snapshot.aggregateFrom.endsWith('+08:00'))
  assert.ok(!snapshot.updatedAt.includes('Z'))
  assert.ok(!snapshot.aggregateFrom.includes('Z'))
  assert.match(snapshot.days[0], /^\d{4}-\d{2}-\d{2}$/)
})

test('聚合起点随当前时刻：23 点后起点为次日 0 点，7 天仍完整', async () => {
  const late = Date.UTC(2026, 7, 10, 16, 0, 0) // 北京 8/11 00:00
  const service = createPrecipitationService({}, { now: () => late, fetchImpl: async () => Response.json(makePayload()) })
  const snapshot = await service.snapshot(null)
  assert.equal(snapshot.aggregateFrom, '2026-08-11 00:00:00+08:00') // 自然日累计
  assert.equal(snapshot.days[0], '2026-08-11')
  assert.equal(snapshot.coveredDays, 7)
})

test('缓存：新鲜期内重复请求不访问上游', async () => {
  let now = T0, fetches = 0
  const service = createPrecipitationService({}, { now: () => now, fetchImpl: async () => { fetches++; return Response.json(makePayload()) } })
  await service.snapshot(null)
  await service.snapshot(null)
  assert.equal(fetches, 1)
  now = T0 + PRECIP_TTL_MS - 1
  await service.snapshot(null)
  assert.equal(fetches, 1)
})

test('缓存过期后重新拉取；并发请求合并为一次上游调用', async () => {
  let now = T0, fetches = 0
  const service = createPrecipitationService({}, { now: () => now, fetchImpl: async () => { fetches++; return Response.json(makePayload()) } })
  await service.snapshot(null)
  now = T0 + PRECIP_TTL_MS + 1
  const [a, b] = await Promise.all([service.snapshot(null), service.snapshot(null)])
  assert.equal(fetches, 2)
  assert.equal(a.grid.length, 399); assert.equal(b.grid.length, 399)
})

test('上游失败且无缓存：抛出 PrecipitationError 不降级为"无降水"', async () => {
  const service = createPrecipitationService({}, { now: () => T0, fetchImpl: async () => { throw new Error('boom') } })
  await assert.rejects(service.snapshot(null), (error) => error instanceof PrecipitationError && error.kind === 'network')
})

test('上游失败且有旧快照：返回 stale 快照并标注失败信息', async () => {
  let now = T0, fail = false
  const service = createPrecipitationService({}, { now: () => now, fetchImpl: async () => { if (fail) throw new Error('upstream down'); return Response.json(makePayload()) } })
  await service.snapshot(null)
  now = T0 + PRECIP_TTL_MS + 1
  fail = true
  const stale = await service.snapshot(null)
  assert.equal(stale.stale, true)
  assert.ok(stale.refreshError)
  assert.equal(stale.grid.length, 399)
})

test('上游 5xx / 429 / 结构异常 / 点数不符均按降级错误处理', async () => {
  const service500 = createPrecipitationService({}, { now: () => T0, fetchImpl: async () => Response.json({}, { status: 500 }) })
  await assert.rejects(service500.snapshot(null), (e) => e instanceof PrecipitationError && e.kind === 'http')
  const service429 = createPrecipitationService({}, { now: () => T0, fetchImpl: async () => Response.json({}, { status: 429 }) })
  await assert.rejects(service429.snapshot(null), (e) => e instanceof PrecipitationError && e.kind === 'http' && e.status === 429)
  const serviceBroken = createPrecipitationService({}, { now: () => T0, fetchImpl: async () => Response.json({ not: 'array' }) })
  await assert.rejects(serviceBroken.snapshot(null), (e) => e instanceof PrecipitationError && e.kind === 'structure')
  const serviceShort = createPrecipitationService({}, { now: () => T0, fetchImpl: async () => Response.json(makePayload({ points: 100 })) })
  await assert.rejects(serviceShort.snapshot(null), (e) => e instanceof PrecipitationError && e.kind === 'structure')
})

test('时次不足 24：结构异常拒绝', async () => {
  const service = createPrecipitationService({}, { now: () => T0, fetchImpl: async () => Response.json(makePayload({ hours: 12 })) })
  await assert.rejects(service.snapshot(null), (e) => e instanceof PrecipitationError && e.kind === 'structure')
})

test('请求取消（aborted）：抛出 aborted 错误，不返回 stale', async () => {
  const service = createPrecipitationService({}, {
    now: () => T0,
    fetchImpl: async (url, init) => {
      await new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        setTimeout(resolve, 20)
      })
      return Response.json(makePayload())
    },
  })
  const controller = new AbortController()
  const pending = service.snapshot(controller.signal)
  controller.abort()
  await assert.rejects(pending, (e) => e instanceof PrecipitationError && e.kind === 'aborted')
})
