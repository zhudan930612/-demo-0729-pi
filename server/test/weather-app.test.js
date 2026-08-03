import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createAppServer } from '../src/app.js'
import { WeatherSpatialError } from '../src/weather-spatial-index.js'

const servers = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))))
async function start(weatherService, weather = {}) {
  const server = createAppServer({ developerId: '', key: '', upstreamConcurrency: 1, cacheTtlMs: 1, cacheMaxEntries: 1, rateLimitPerMinute: 100, rateLimitMaxClients: 10, weather }, { weatherService, logger: { info() {}, error() {} } })
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
