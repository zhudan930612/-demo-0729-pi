import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { loadWeatherSpatialIndex, WeatherSpatialError } from '../src/weather-spatial-index.js'
import { parseWeatherRequest, createWeatherService } from '../src/weather-service.js'
import { createWeatherUpstream, normalizeQWeather, WeatherUpstreamError } from '../src/weather-upstream.js'
import { createWeatherCache } from '../src/weather-cache.js'

const dataDir = path.resolve('test/fixtures/weather-data')
const config = { authMode: 'api-key', apiOrigin: 'https://weather.example', apiKey: 'secret-key', projectId: 'project', credentialId: 'credential', dataDir, addressUrl: '', timeoutMs: 100, maxNetworkBytes: 1024 * 1024, maxDecodedBytes: 1024 * 1024, cacheMaxEntries: 100 }
function url(query) { return new URL(`/api/weather?${query}`, 'http://localhost') }
function payload(module) {
  if (module === 'alert') return { alerts: [], metadata: { zeroResult: true, attributions: [] } }
  if (module === 'current') return { current: { observationTime: '2026-08-03T10:00:00+08:00', condition: { code: '100', text: '晴' }, temperature: { value: 26, unit: '°C' }, feelsLike: { value: 27, unit: '°C' }, precipitation: { amount: { value: 0, unit: 'mm' }, intensity: { value: 0, unit: 'mm/h' }, type: 'none' }, humidity: 0.8 }, metadata: { attributions: [] } }
  if (module === 'hourly') return { hourly: [{ forecastTime: '2026-08-03T11:00:00+08:00', condition: { code: '100', text: '晴' }, temperature: { value: 27, unit: '°C' }, precipitation: { probability: 0.1, amount: { value: 0, unit: 'mm' } } }], metadata: { attributions: [] } }
  return { code: '204' }
}

test('spatial index validates strict request contract and point-in-polygon', () => {
  const spatial = loadWeatherSpatialIndex(dataDir)
  assert.equal(parseWeatherRequest(url('contextLevel=city&contextCode=330100&target=admin'), spatial).lon, 120)
  assert.equal(parseWeatherRequest(url('contextLevel=village&contextCode=330101001001&target=parcel&lat=30.01&lon=120.01'), spatial).target, 'parcel')
  assert.equal(parseWeatherRequest(url('contextLevel=city&contextCode=330100&target=picked&lat=30.2&lon=120.2'), spatial).target, 'picked')
  for (const query of ['contextLevel=city&contextCode=330100&target=admin&lat=30', 'contextLevel=city&contextCode=330100&target=admin&extra=1', 'contextLevel=city&contextCode=330100&contextCode=330101&target=admin']) assert.throws(() => parseWeatherRequest(url(query), spatial), WeatherSpatialError)
  assert.throws(() => parseWeatherRequest(url('contextLevel=city&contextCode=330100&target=picked&lat=32&lon=120'), spatial), (e) => e.kind === 'outside')
  assert.throws(() => parseWeatherRequest(url('contextLevel=village&contextCode=330101001001&target=parcel&lat=30.5&lon=120'), spatial), (e) => e.kind === 'outside')
})

test('service uses rounded coordinates, fans out alerts, omits township alerts, and degrades address', async () => {
  const calls = []
  const upstream = { qweather: async (module, lat, lon) => { calls.push({ module, lat, lon }); const raw = payload(module); return module === 'minutely' ? { data: null, metadata: {}, empty: true } : normalizeQWeather(module, raw) }, address: async () => { throw new WeatherUpstreamError('unconfigured', 'off') } }
  const service = createWeatherService(config, { upstream })
  const picked = service.parse(url('contextLevel=city&contextCode=330100&target=picked&lat=30.014&lon=120.016'))
  const result = await service.bundle(picked)
  assert.deepEqual(result.location, { lat: 30.01, lon: 120.02 })
  assert.equal(result.current.status, 'success'); assert.equal(result.minutely.status, 'empty'); assert.equal(result.address.status, 'error')
  assert.equal(result.alerts.data.length, 1)
  assert.ok(calls.filter((c) => ['current', 'hourly', 'minutely'].includes(c.module)).every((c) => c.lat === 30.01 && c.lon === 120.02))
  calls.length = 0
  const township = service.parse(url('contextLevel=township&contextCode=330101001000&target=admin'))
  assert.equal((await service.bundle(township)).alerts.message, '天气预警查看到县级')
  assert.equal(calls.some((c) => c.module === 'alert'), false)
})

test('QWeather client constructs safe endpoint/query/header and address preserves raw lon lat', async () => {
  const seen = []
  const fetchImpl = async (requestUrl, init) => { seen.push({ url: requestUrl, init }); if (requestUrl.origin === 'https://address.example') return Response.json({ address: '测试地址', hctype: 2, jd: '附近' }); const pathname = requestUrl.pathname; if (pathname.includes('hourly')) return Response.json(payload('hourly')); if (pathname.includes('current')) return Response.json(payload('current')); return Response.json(payload('minutely')) }
  const upstream = createWeatherUpstream({ ...config, addressUrl: 'https://address.example/reverse?credential=server-only' }, { fetchImpl })
  await upstream.qweather('current', 30.01, 120.02)
  await upstream.qweather('hourly', 30.01, 120.02)
  await upstream.qweather('minutely', 30.01, 120.02)
  await upstream.address(120.016789, 30.014321)
  assert.equal(seen[0].url.pathname, '/weather/v1/current/30.01/120.02'); assert.equal(seen[0].url.searchParams.get('localTime'), 'true'); assert.equal(seen[0].init.headers['X-QW-Api-Key'], 'secret-key')
  assert.equal(seen[1].url.searchParams.get('hours'), '24'); assert.equal(seen[2].url.searchParams.get('location'), '120.02,30.01'); assert.equal(seen[2].url.searchParams.get('lang'), 'zh')
  assert.equal(seen[3].url.searchParams.get('lon'), '120.016789'); assert.equal(seen[3].url.searchParams.get('lat'), '30.014321')
})

test('cache merges in-flight, applies TTL, stale-on-refresh and shared retry-after cooldown', async () => {
  let now = 0, calls = 0, resolve
  const cache = createWeatherCache({ now: () => now, random: () => 0, ttls: { current: 10 } })
  const loader = () => { calls++; return new Promise((done) => { resolve = done }) }
  const a = cache.subscribe('current', 'key', loader), b = cache.subscribe('current', 'key', loader); await Promise.resolve(); assert.equal(calls, 1); a.release(); resolve({ data: { value: 1 }, metadata: {} }); await b.promise; b.release()
  assert.equal((await cache.subscribe('current', 'key', loader).promise).data.value, 1)
  now = 11
  const stale = cache.subscribe('current', 'key', async () => { calls++; throw new WeatherUpstreamError('rate-limit', 'limit', { retryAfterMs: 100 }) })
  assert.equal((await stale.promise).stale, true); stale.release()
  assert.equal((await cache.subscribe('current', 'key', loader).promise).stale, true); assert.equal(calls, 2)
})

test('one disconnected cache consumer does not abort the other', async () => {
  let signal, resolve
  const cache = createWeatherCache()
  const loader = (s) => { signal = s; return new Promise((done) => { resolve = done }) }
  const a = cache.subscribe('current', 'x', loader), b = cache.subscribe('current', 'x', loader); await Promise.resolve(); a.release(); assert.equal(signal.aborted, false); resolve({ data: {}, metadata: {} }); await b.promise; b.release()
})

test('gzip is decoded and compressed/decoded limits fail closed', async () => {
  const raw = Buffer.from(JSON.stringify(payload('current'))), zipped = gzipSync(raw)
  const ok = createWeatherUpstream(config, { fetchImpl: async () => new Response(zipped, { headers: { 'content-encoding': 'gzip', 'content-length': String(zipped.length) } }) })
  assert.equal((await ok.qweather('current', 30, 120)).data.condition.text, '晴')
  const network = createWeatherUpstream({ ...config, maxNetworkBytes: 5 }, { fetchImpl: async () => new Response(zipped, { headers: { 'content-encoding': 'gzip' } }) })
  await assert.rejects(network.qweather('current', 30, 120), (e) => e.kind === 'too-large')
  const decoded = createWeatherUpstream({ ...config, maxDecodedBytes: 10 }, { fetchImpl: async () => new Response(zipped, { headers: { 'content-encoding': 'gzip' } }) })
  await assert.rejects(decoded.qweather('current', 30, 120), (e) => e.kind === 'too-large')
  const broken = createWeatherUpstream(config, { fetchImpl: async () => new Response(Buffer.from([0x1f, 0x8b, 1]), { headers: { 'content-encoding': 'gzip' } }) })
  await assert.rejects(broken.qweather('current', 30, 120), (e) => e.kind === 'decompression')
})

test('alert whitelist removes superseded and cancel messages', () => {
  const data = normalizeQWeather('alert', { alerts: [
    { id: 'old', headline: '旧', messageType: { code: 'Alert', supersedes: [] } },
    { id: 'new', headline: '新', messageType: { code: 'Update', supersedes: ['old'] } },
    { id: 'cancel', headline: '取消', messageType: { code: 'Cancel', supersedes: [] } },
  ], metadata: {} }).data
  assert.deepEqual(data.map((item) => item.id), ['new'])
  assert.deepEqual(Object.keys(data[0]).sort(), ['certainty','color','criteria','description','effectiveTime','eventType','expireTime','headline','icon','id','instruction','issuedTime','messageType','onsetTime','responseTypes','senderName','severity','urgency'].sort())
})
