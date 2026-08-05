import assert from 'node:assert/strict'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { createAppServer } from '../src/app.js'
import { createWeatherService } from '../src/weather-service.js'
import { normalizeQWeather } from '../src/weather-upstream.js'
import { WeatherSpatialError } from '../src/weather-spatial-index.js'

const servers = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))))
async function start(weatherService, weather = {}, nationalAlarmService) {
  const server = createAppServer({ developerId: '', key: '', upstreamConcurrency: 1, cacheTtlMs: 1, cacheMaxEntries: 1, rateLimitPerMinute: 100, rateLimitMaxClients: 10, weather }, { weatherService, nationalAlarmService, logger: { info() {}, error() {} } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}

test('invalid/outside weather request does not call bundle/upstream', async () => {
  let calls = 0
  const weatherService = { parse() { throw new WeatherSpatialError('outside', 'no') }, async bundle() { calls++ }, clearCache() {} }
  const base = await start(weatherService)
  const response = await fetch(`${base}/api/weather?contextLevel=city&contextCode=1&target=admin`)
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'WEATHER_LOCATION_OUT_OF_ZHEJIANG'); assert.equal(calls, 0)
})

test('national alarm routes reject parameters and only expose the service payload', async () => {
  const payload = { items: [{ id: '330100000001', title: '浙江预警', provinceCode: '33', mapLocation: { status: 'unmapped' } }], summary: { total: 1, snapshotTotal: 1 }, fetchedAt: '2026-08-04T00:00:00.000Z', expiresAt: '2026-08-04T00:05:00.000Z', source: '中央气象台（NMC），仅展示浙江省预警' }
  let forced = 0
  const service = { async list() { return payload }, async forceRefresh() { forced++; return payload }, async detail(id) { if (id !== '330100000001') { const error = new Error('missing'); error.name = 'NationalAlarmError'; error.kind = 'not-found'; throw error }; return { id, issuedAt: null, body: '正文' } } }
  const base = await start({ parse() { return {} }, async bundle() { return {} }, clearCache() {} }, {}, service)
  assert.equal((await fetch(`${base}/api/national-weather-alarms?x=1`)).status, 400)
  assert.equal((await fetch(`${base}/api/national-weather-alarms`)).status, 200)
  assert.equal((await fetch(`${base}/api/national-weather-alarms/330100000001`)).status, 200)
  assert.equal((await fetch(`${base}/api/national-weather-alarms/330100000001?x=1`)).status, 400)
  assert.equal((await fetch(`${base}/api/national-weather-alarms/refresh`, { method: 'POST', body: 'x' })).status, 400)
  assert.equal((await fetch(`${base}/api/national-weather-alarms/refresh`, { method: 'POST' })).status, 200); assert.equal(forced, 1)
})

test('weather response and protected local cache clear route work without anonymous access', async () => {
  let cleared = 0
  const weatherService = { parse() { return {} }, async bundle() { return { current: { status: 'success' } } }, clearCache() { cleared++ } }
  const base = await start(weatherService, { adminToken: 'admin-secret' })
  assert.equal((await fetch(`${base}/api/weather?contextLevel=province&contextCode=330000&target=admin`)).status, 200)
  assert.equal((await fetch(`${base}/api/weather/cache`, { method: 'DELETE' })).status, 403)
  assert.equal((await fetch(`${base}/api/weather/cache`, { method: 'DELETE', headers: { 'x-weather-admin-token': 'wrong' } })).status, 403)
  assert.equal((await fetch(`${base}/api/weather/cache`, { method: 'DELETE', headers: { 'x-weather-admin-token': 'admin-secret' } })).status, 204)
  assert.equal(cleared, 1)
})

test('markers route streams NDJSON skeleton then per-target events with strict parameter whitelist', async () => {
  const upstream = {
    async qweather(module, lat, lon) { const raw = module === 'hourly' ? { hours: [{ forecastTime: '2026-08-03T11:00:00+08:00', condition: { code: '100', text: '晴' }, temperature: { value: 32, unit: '°C' } }, { forecastTime: '2026-08-03T12:00:00+08:00', condition: { code: '100', text: '晴' }, temperature: { value: 22, unit: '°C' } }], metadata: {} } : { condition: { code: '100', text: '晴' }, temperature: { value: 26, unit: '°C' }, humidity: 0.5, metadata: {} }; return normalizeQWeather(module, raw) },
    async address() { throw new Error('markers 不请求地址') },
  }
  const weatherService = createWeatherService({ authMode: 'api-key', apiOrigin: 'https://weather.example', apiKey: 'k', projectId: 'p', credentialId: 'c', dataDir: path.resolve('test/fixtures/weather-data'), seatsFile: 'test/fixtures/weather-data/government-seats-markers-v1.json', addressUrl: '', timeoutMs: 1000, maxNetworkBytes: 1024 * 1024, maxDecodedBytes: 1024 * 1024, cacheMaxEntries: 100, upstreamConcurrency: 6 }, { upstream })
  const base = await start(weatherService)
  const response = await fetch(`${base}/api/weather/markers?contextLevel=county&contextCode=330101`, { headers: { accept: 'application/x-ndjson' } })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /application\/x-ndjson/)
  const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines[0].type, 'targets')
  assert.equal(lines[0].total, 2)
  assert.deepEqual(lines[0].targets.map((t) => t.code), ['330101001000', '330101002000'])
  assert.deepEqual(Object.keys(lines[0].targets[0]).sort(), ['code', 'level', 'location', 'name'])
  const ready = lines.filter((line) => line.type === 'ready')
  assert.equal(ready.length, 2)
  assert.deepEqual(ready[0].summary.high, { value: 32, unit: '°C' })
  assert.deepEqual(ready[0].summary.low, { value: 22, unit: '°C' })
})

test('markers route rejects unknown params, non-GET and empty child levels safely', async () => {
  const weatherService = { parse() { return {} }, parseMarkers() { throw new WeatherSpatialError('parameters', '天气标牌请求参数无效') }, async markers() { throw new Error('must not stream') }, clearCache() {} }
  const base = await start(weatherService)
  assert.equal((await fetch(`${base}/api/weather/markers?contextLevel=county&contextCode=330101&x=1`)).status, 400)
  assert.equal((await fetch(`${base}/api/weather/markers?contextLevel=county&contextCode=330101`, { method: 'POST' })).status, 405)
})

test('markers route returns empty targets skeleton for village context', async () => {
  const weatherService = createWeatherService({ authMode: 'api-key', apiOrigin: 'https://weather.example', apiKey: 'k', projectId: 'p', credentialId: 'c', dataDir: path.resolve('test/fixtures/weather-data'), seatsFile: 'test/fixtures/weather-data/government-seats-markers-v1.json', addressUrl: '', timeoutMs: 1000, maxNetworkBytes: 1024 * 1024, maxDecodedBytes: 1024 * 1024, cacheMaxEntries: 100, upstreamConcurrency: 6 }, { upstream: { async qweather() { throw new Error('no calls') }, async address() { throw new Error('no calls') } } })
  const base = await start(weatherService)
  const response = await fetch(`${base}/api/weather/markers?contextLevel=village&contextCode=330101001001`)
  assert.equal(response.status, 200)
  const lines = (await response.text()).trim().split('\n').map((line) => JSON.parse(line))
  assert.deepEqual(lines, [{ type: 'targets', contextLevel: 'village', contextCode: '330101001001', total: 0, targets: [] }])
})
