import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, test } from 'node:test'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { createWeatherCache } from '../src/weather-cache.js'
import { createWeatherService } from '../src/weather-service.js'
import { loadWeatherSpatialIndex, WeatherSpatialError } from '../src/weather-spatial-index.js'
import { createWeatherUpstream, normalizeQWeather, WeatherUpstreamError } from '../src/weather-upstream.js'

const servers = []
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))))
const dataDir = path.resolve('test/fixtures/weather-data')
const baseConfig = { authMode: 'api-key', apiOrigin: 'https://weather.example', apiKey: 'secret', projectId: 'project', credentialId: 'credential', dataDir, addressUrl: '', timeoutMs: 1000, maxNetworkBytes: 1024 * 1024, maxDecodedBytes: 1024 * 1024, cacheMaxEntries: 100, upstreamConcurrency: 6 }
function currentPayload() { return { current: { observationTime: '2026-08-03T10:00:00+08:00', condition: { code: '100', text: '晴' }, temperature: { value: 26, unit: '°C' }, humidity: 0.5 }, metadata: {} } }
function responseFor(module) { if (module === 'alert') return { data: [{ id: 'shared', headline: '预警', messageType: { code: 'Alert', supersedes: [] }, responseTypes: ['Prepare'] }], metadata: {} }; if (module === 'current') return normalizeQWeather('current', currentPayload()); if (module === 'hourly') return normalizeQWeather('hourly', { hourly: [{ forecastTime: '2026-08-03T11:00:00+08:00', condition: { code: '100', text: '晴' }, temperature: { value: 27, unit: '°C' } }], metadata: {} }); return { data: null, metadata: {}, empty: true } }

test('province eleven-region fan-out waits at configured concurrency and settles every region', async () => {
  const children = Array.from({ length: 11 }, (_, i) => Object.freeze({ code: `330${String(i + 1).padStart(3, '0')}`, name: `市${i}`, level: 'city', representativePoint: Object.freeze([120 + i / 100, 30]), childrenCodes: Object.freeze([]) }))
  const province = Object.freeze({ code: '330000', name: '浙江省', level: 'province', representativePoint: Object.freeze([120, 30]), childrenCodes: Object.freeze(children.map((x) => x.code)) })
  const spatial = { get: () => province, province: () => province, alertNodes: () => children, covers: () => true }
  let active = 0, peak = 0, alertCalls = 0
  const upstream = { async qweather(module) { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 8)); active--; if (module === 'alert') alertCalls++; return responseFor(module) }, async address() { throw new WeatherUpstreamError('unconfigured', 'off') } }
  const service = createWeatherService({ ...baseConfig, upstreamConcurrency: 6 }, { upstream, loadSpatial: () => spatial })
  const result = await service.bundle(service.parse(new URL('http://local/api/weather?contextLevel=province&contextCode=330000&target=admin')))
  assert.equal(alertCalls, 11); assert.equal(result.alerts.data.length, 11); assert.equal(result.alerts.status, 'success'); assert.equal(peak, 6)
  assert.equal(result.alerts.details.length, 1); assert.deepEqual(result.alerts.details[0].matchedContextCodes, children.map((x) => x.code))
  assert.ok(result.alerts.data.every((region) => region.fetchedAt && region.expiresAt))
})

test('alert fan-out settles subscription creation failures as region errors and reports partial/all failure', async () => {
  const children = Array.from({ length: 2 }, (_, i) => Object.freeze({ code: `33010${i}`, name: `市${i}`, level: 'city', representativePoint: Object.freeze([120 + i, 30]), childrenCodes: Object.freeze([]) }))
  const province = Object.freeze({ code: '330000', name: '浙江省', level: 'province', representativePoint: Object.freeze([120, 30]), childrenCodes: Object.freeze(children.map((x) => x.code)) })
  const spatial = { get: () => province, province: () => province, alertNodes: () => children, covers: () => true }
  let failAll = false
  const cache = { subscribe(module, key, loader) { if (module === 'alert' && (failAll || key.includes('121'))) throw new WeatherUpstreamError('busy', 'busy'); return { promise: Promise.resolve(responseFor(module)), release() {} } }, clear() {}, stats() { return {} } }
  const upstream = { async address() { throw new WeatherUpstreamError('unconfigured', 'off') } }
  const service = createWeatherService(baseConfig, { upstream, cache, loadSpatial: () => spatial })
  const request = service.parse(new URL('http://local/api/weather?contextLevel=province&contextCode=330000&target=admin'))
  const partial = await service.bundle(request); assert.equal(partial.alerts.status, 'partial'); assert.deepEqual(partial.alerts.data.map((x) => x.status), ['success','error'])
  failAll = true; const failed = await service.bundle(request); assert.equal(failed.alerts.status, 'error'); assert.ok(failed.alerts.data.every((x) => x.status === 'error'))
})

test('spatial index eagerly rejects unreachable node and malformed geometry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-index-'))
  fs.mkdirSync(path.join(root, 'weather')); fs.mkdirSync(path.join(root, 'boundary'))
  const polygon = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: '330000', name: '浙江省' }, geometry: { type: 'Polygon', coordinates: [[[119,29],[121,29],[121,31],[119,31],[119,29]]] } }] }
  fs.writeFileSync(path.join(root, 'boundary/p.geojson'), JSON.stringify(polygon))
  fs.writeFileSync(path.join(root, 'weather/index-v2.json'), JSON.stringify({ schemaVersion: 2, provinceCode: '330000', nodes: [{ code: '330000', name: '浙江省', level: 'province', parentCode: null, childrenCodes: [], representativePoint: [120,30], boundary: { path: 'boundary/p.geojson', featureCode: '330000' } }, { code: '330100', name: '孤儿', level: 'city', parentCode: '330000', childrenCodes: [], representativePoint: [120,30], boundary: { path: 'boundary/p.geojson', featureCode: '330100' } }] }))
  assert.throws(() => loadWeatherSpatialIndex(root), WeatherSpatialError)
  polygon.features[0].geometry.coordinates[0].pop(); fs.writeFileSync(path.join(root, 'boundary/p.geojson'), JSON.stringify(polygon)); fs.writeFileSync(path.join(root, 'weather/index-v2.json'), JSON.stringify({ schemaVersion: 2, provinceCode: '330000', nodes: [{ code: '330000', name: '浙江省', level: 'province', parentCode: null, childrenCodes: [], representativePoint: [120,30], boundary: { path: 'boundary/p.geojson', featureCode: '330000' } }] }))
  assert.throws(() => loadWeatherSpatialIndex(root), WeatherSpatialError)
})

test('spatial index rejects a representative point outside its parent chain', () => {
  const source = path.resolve('test/fixtures/weather-data')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-parent-chain-'))
  fs.cpSync(source, root, { recursive: true })
  const cityPath = path.join(root, 'boundary/city.geojson')
  const city = JSON.parse(fs.readFileSync(cityPath, 'utf8'))
  city.features[0].geometry.coordinates = [[[130,40],[131,40],[131,41],[130,41],[130,40]]]
  fs.writeFileSync(cityPath, JSON.stringify(city))
  assert.throws(() => loadWeatherSpatialIndex(root), WeatherSpatialError)
})

test('normalization rejects coercion and invalid ratios while preserving responseTypes', () => {
  assert.throws(() => normalizeQWeather('current', { current: { observationTime: '2026-08-03T10:00:00+08:00', condition: { code: '', text: '晴' }, temperature: { value: null, unit: '°C' } } }), (e) => e.kind === 'structure')
  const current = normalizeQWeather('current', { current: { observationTime: '2026-08-03T10:00:00+08:00', condition: { code: '100', text: '晴' }, temperature: { value: 1, unit: '°C' }, feelsLike: { value: false, unit: '°C' }, humidity: 2 } }).data
  assert.equal(current.feelsLike.value, null); assert.equal(current.humidity, null)
  const alert = normalizeQWeather('alert', { alerts: [{ id: 'a', messageType: {}, responseTypes: ['Prepare', '', false] }] }).data[0]
  assert.deepEqual(alert.responseTypes, ['Prepare'])
})

test('address cache uses collision-resistant full-coordinate SHA-256 keys', async () => {
  const keys = []
  const cache = { subscribe(module, key) { keys.push({ module, key }); return { promise: Promise.reject(new WeatherUpstreamError('unconfigured', 'off')), release() {} } }, clear() {}, stats() { return {} } }
  const point = Object.freeze({ code: '330000', name: '浙江省', level: 'province', representativePoint: Object.freeze([120, 30]), childrenCodes: Object.freeze([]) })
  const spatial = { get: () => point, province: () => point, alertNodes: () => [], covers: () => true }
  const service = createWeatherService(baseConfig, { cache, loadSpatial: () => spatial, upstream: {} })
  for (const lon of [120.0000001, 120.0000002]) await service.bundle({ contextLevel: 'province', contextCode: '330000', target: 'picked', node: point, lon, lat: 30 })
  const addresses = keys.filter((item) => item.module === 'address').map((item) => item.key)
  assert.equal(addresses.length, 2); assert.notEqual(addresses[0], addresses[1]); assert.match(addresses[0], /^address:[a-f0-9]{64}$/); assert.equal(addresses.some((key) => key.includes('120')), false)
})

test('address URL security and business failure fail closed', async () => {
  for (const addressUrl of ['http://address.example/path', 'https://user@address.example/path', 'https://address.example/path#secret']) {
    const client = createWeatherUpstream({ ...baseConfig, addressUrl }, { transport: async () => assert.fail('must not call transport') })
    await assert.rejects(client.address(120, 30), (e) => e.kind === 'unconfigured')
  }
  const client = createWeatherUpstream({ ...baseConfig, addressUrl: 'https://address.example/path' }, { fetchImpl: async () => Response.json({ code: 500, address: '错误地址' }) })
  await assert.rejects(client.address(120, 30), (e) => e.kind === 'structure')
})

test('cache queues, opens auth breaker, retries recoverable errors and bounds cooldowns', async () => {
  let active = 0, peak = 0
  const cache = createWeatherCache({ maxConcurrency: 2, maxCooldowns: 2, random: () => 0 })
  const loads = Array.from({ length: 5 }, (_, i) => cache.subscribe('current', `k${i}`, async () => { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 5)); active--; return { data: i } }))
  await Promise.all(loads.map((item) => item.promise)); loads.forEach((item) => item.release()); assert.equal(peak, 2)
  let authCalls = 0
  const auth = () => cache.subscribe('hourly', 'auth', async () => { authCalls++; throw new WeatherUpstreamError('authentication', 'bad') })
  await assert.rejects(auth().promise); await assert.rejects(auth().promise); assert.equal(authCalls, 1)
  cache.clear(); for (let i = 0; i < 4; i++) await assert.rejects(cache.subscribe('minutely', `r${i}`, async () => { throw new WeatherUpstreamError('network', 'down') }).promise)
  assert.equal(cache.stats().cooldownSize, 2)
  let stamp = 0
  const rate = createWeatherCache({ now: () => stamp, random: () => 0 }); await assert.rejects(rate.subscribe('alert', 'x', async () => { throw new WeatherUpstreamError('rate-limit', 'limit', { retryAfterMs: 12345 }) }).promise)
  assert.equal(rate.stats().cooldownSize, 1); stamp = 12346; assert.equal(rate.stats().cooldownSize, 0)
})

async function startCompressedServer(handler) { const server = http.createServer(handler); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); servers.push(server); return `http://127.0.0.1:${server.address().port}` }
test('raw transport enforces compressed and decoded streaming limits for gzip br deflate and mismatch', async () => {
  const raw = Buffer.from(JSON.stringify(currentPayload()))
  for (const [encoding, encode] of [['gzip', gzipSync], ['br', brotliCompressSync], ['deflate', deflateSync]]) {
    const base = await startCompressedServer((_request, response) => { response.writeHead(200, { 'content-encoding': encoding }); const bytes = encode(raw); for (let i = 0; i < bytes.length; i += 3) response.write(bytes.subarray(i, i + 3)); response.end() })
    const result = await createWeatherUpstream({ ...baseConfig, apiOrigin: base }).qweather('current', 30, 120); assert.equal(result.data.condition.text, '晴'); assert.equal(result.metrics.contentEncoding, encoding)
  }
  const mismatch = await startCompressedServer((_request, response) => { response.writeHead(200, { 'content-encoding': 'gzip' }); response.end(raw) })
  await assert.rejects(createWeatherUpstream({ ...baseConfig, apiOrigin: mismatch }).qweather('current', 30, 120), (e) => e.kind === 'decompression')
  const compressed = gzipSync(Buffer.from(JSON.stringify({ ...currentPayload(), padding: 'x'.repeat(10_000) })))
  const overNetwork = await startCompressedServer((_request, response) => { response.writeHead(200, { 'content-encoding': 'gzip' }); response.write(compressed.subarray(0, 10)); response.end(compressed.subarray(10)) })
  await assert.rejects(createWeatherUpstream({ ...baseConfig, apiOrigin: overNetwork, maxNetworkBytes: 5 }).qweather('current', 30, 120), (e) => e.kind === 'too-large')
  await assert.rejects(createWeatherUpstream({ ...baseConfig, apiOrigin: overNetwork, maxDecodedBytes: 50 }).qweather('current', 30, 120), (e) => e.kind === 'too-large')
})

test('injectable raw transport remains supported', async () => {
  let called = 0
  const transport = async () => { called++; return { status: 200, headers: { 'content-encoding': 'identity' }, stream: Readable.from([Buffer.from(JSON.stringify(currentPayload()))]) } }
  const result = await createWeatherUpstream(baseConfig, { transport }).qweather('current', 30, 120)
  assert.equal(called, 1); assert.equal(result.data.temperature.value, 26)
})
