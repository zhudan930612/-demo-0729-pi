import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createAppServer } from '../src/app.js'
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
