import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { loadWeatherSeatIndex } from '../src/weather-seat-index.js'
import { parseWeatherRequest, parseWeatherMarkersRequest, createWeatherService } from '../src/weather-service.js'
import { loadWeatherSpatialIndex, WeatherSpatialError } from '../src/weather-spatial-index.js'
import { normalizeQWeather } from '../src/weather-upstream.js'

const dataDir = path.resolve('test/fixtures/weather-data')
const seatsFile = 'test/fixtures/weather-data/government-seats-markers-v1.json'
const config = { authMode: 'api-key', apiOrigin: 'https://weather.example', apiKey: 'secret-key', projectId: 'project', credentialId: 'credential', dataDir, seatsFile, addressUrl: '', timeoutMs: 1000, maxNetworkBytes: 1024 * 1024, maxDecodedBytes: 1024 * 1024, cacheMaxEntries: 100, upstreamConcurrency: 6 }
function url(query) { return new URL(`/api/weather?${query}`, 'http://localhost') }
function markersUrl(query) { return new URL(`/api/weather/markers?${query}`, 'http://localhost') }
function currentPayload(temp = 26) { return { condition: { code: '100', text: '晴' }, temperature: { value: temp, unit: '°C' }, humidity: 0.5, metadata: {} } }
function hourlyPayload(temps) { return { hours: temps.map((value) => ({ forecastTime: '2026-08-03T11:00:00+08:00', condition: { code: '100', text: '晴' }, temperature: { value, unit: '°C' } })), metadata: {} } }
function seatIndex() { return loadWeatherSeatIndex(dataDir, seatsFile) }

test('seat index validates trusted seats per level and returns children targets with diagnostics', () => {
  const index = seatIndex()
  const spatial = loadWeatherSpatialIndex(dataDir)
  const province = spatial.get('330000', 'province')
  const city = spatial.get('330100', 'city')
  const county = spatial.get('330101', 'county')
  assert.deepEqual(index.seatFor(county).point, [120.1, 30.1])
  assert.deepEqual(index.children(province).targets.map((t) => t.code), ['330100'])
  assert.deepEqual(index.children(city).targets.map((t) => t.code), ['330101'])
  const townshipChildren = index.children(county)
  assert.deepEqual(townshipChildren.targets.map((t) => t.code), ['330101001000', '330101002000'])
  assert.deepEqual(townshipChildren.diagnostics, { 'not-candidate': 1, 'out-of-boundary': 1 })
  assert.deepEqual(index.children(spatial.get('330101001000', 'township')).targets, [])
  assert.deepEqual(index.children(spatial.get('330101001001', 'village')).targets, [])
  assert.throws(() => index.get('330199', 'city'), (e) => e.kind === 'outside')
  assert.equal(index.seatFor(spatial.get('330101004000', 'township')), null)
})

test('seat target is strictly controlled: level whitelist, no self-reported coordinates, server resolves seat', () => {
  const spatial = loadWeatherSpatialIndex(dataDir)
  const resolved = parseWeatherRequest(url('contextLevel=county&contextCode=330101&target=seat'), spatial, seatIndex())
  assert.equal(resolved.target, 'seat'); assert.deepEqual([resolved.lon, resolved.lat], [120.1, 30.1])
  const township = parseWeatherRequest(url('contextLevel=township&contextCode=330101001000&target=seat'), spatial, seatIndex())
  assert.deepEqual([township.lon, township.lat], [120.0, 30.0])
  for (const query of [
    'contextLevel=province&contextCode=330000&target=seat',
    'contextLevel=village&contextCode=330101001001&target=seat',
    'contextLevel=township&contextCode=330101004000&target=seat',
    'contextLevel=county&contextCode=330101&target=seat&lat=30',
    'contextLevel=county&contextCode=330101&target=seat&lon=120',
    'contextLevel=county&contextCode=330101&target=seat&x=1',
  ]) assert.throws(() => parseWeatherRequest(url(query), spatial, seatIndex()), WeatherSpatialError)
})

test('markers request rejects unknown or repeated parameters and invalid codes', () => {
  const spatial = loadWeatherSpatialIndex(dataDir)
  const parsed = parseWeatherMarkersRequest(markersUrl('contextLevel=county&contextCode=330101'), spatial)
  assert.equal(parsed.contextLevel, 'county'); assert.equal(parsed.contextCode, '330101')
  for (const query of ['contextLevel=county&contextCode=330101&lat=30', 'contextLevel=county&contextCode=330101&contextLevel=city', 'contextLevel=foo&contextCode=330101', 'contextLevel=county&contextCode=1']) assert.throws(() => parseWeatherMarkersRequest(markersUrl(query), spatial), WeatherSpatialError)
})

test('markers stream emits targets first then ready events with cached upstream reuse', async () => {
  const calls = []
  const upstream = {
    async qweather(module, lat, lon) { calls.push({ module, lat, lon }); const raw = module === 'hourly' ? hourlyPayload([33, 24, 28]) : currentPayload(26); return normalizeQWeather(module, raw) },
    async address() { throw new Error('markers must not request address') },
  }
  const service = createWeatherService(config, { upstream })
  const stream = service.markers(service.parseMarkers(markersUrl('contextLevel=county&contextCode=330101')))
  const events = []
  for await (const event of stream) events.push(event)
  assert.equal(events[0].type, 'targets')
  assert.equal(events[0].total, 2)
  assert.deepEqual(events[0].targets.map((t) => t.code), ['330101001000', '330101002000'])
  assert.deepEqual(events[0].targets[0].location, { lat: 30.0, lon: 120.0 })
  for (const target of events[0].targets) assert.deepEqual(Object.keys(target).sort(), ['code', 'level', 'location', 'name'])
  const ready = events.filter((e) => e.type === 'ready')
  assert.equal(ready.length, 2)
  assert.deepEqual(ready[0].summary, { condition: { code: '100', text: '晴' }, temperature: { value: 26, unit: '°C' }, high: { value: 33, unit: '°C' }, low: { value: 24, unit: '°C' }, fetchedAt: ready[0].summary.fetchedAt })
  assert.equal(calls.some((c) => c.module === 'address'), false)
  assert.equal(calls.filter((c) => c.module === 'minutely').length, 0)
})

test('markers stream keeps successful targets when another target fails and reports error separately', async () => {
  const upstream = {
    async qweather(module, lat, lon) { if (lat === 29.75) throw new Error('上游故障'); const raw = module === 'hourly' ? hourlyPayload([30]) : currentPayload(25); return normalizeQWeather(module, raw) },
    async address() { throw new Error('off') },
  }
  const service = createWeatherService(config, { upstream })
  const events = []
  for await (const event of service.markers(service.parseMarkers(markersUrl('contextLevel=county&contextCode=330101')))) events.push(event)
  const ready = events.filter((e) => e.type === 'ready'), errors = events.filter((e) => e.type === 'error')
  assert.equal(ready.length, 1); assert.equal(ready[0].code, '330101001000')
  assert.equal(errors.length, 1); assert.equal(errors[0].code, '330101002000')
  assert.ok(errors[0].error.code && errors[0].error.message)
  assert.equal(errors[0].error.code.includes('KEY'), false)
})

test('markers stream aborts mid-flight, stops yielding events and bounds concurrency', async () => {
  const controller = new AbortController()
  let active = 0, peak = 0
  const upstream = {
    async qweather(module, lat, lon) {
      if (module !== 'current') return normalizeQWeather('hourly', hourlyPayload([30]))
      active++; peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active--
      return normalizeQWeather('current', currentPayload(26))
    },
    async address() { throw new Error('off') },
  }
  const service = createWeatherService(config, { upstream })
  const stream = service.markers(service.parseMarkers(markersUrl('contextLevel=county&contextCode=330101')), controller.signal)
  const iterator = stream[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.equal(first.value.type, 'targets')
  setTimeout(() => controller.abort(), 5)
  let producedAfterAbort = []
  for (let i = 0; i < 6; i++) {
    const result = await Promise.race([iterator.next(), new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 200))])
    if (result.timedOut) break
    if (result.done) break
    producedAfterAbort.push(result.value.type)
  }
  assert.deepEqual(producedAfterAbort, [], 'aborted stream must not keep yielding ready/error events')
  assert.ok(peak <= 4, `并发应受控，实际 ${peak}`)
})

test('markers stream returns empty target list for village context without upstream calls', async () => {
  let calls = 0
  const upstream = { async qweather() { calls++; throw new Error('off') }, async address() { throw new Error('off') } }
  const service = createWeatherService(config, { upstream })
  const events = []
  for await (const event of service.markers(service.parseMarkers(markersUrl('contextLevel=village&contextCode=330101001001')))) events.push(event)
  assert.deepEqual(events, [{ type: 'targets', contextLevel: 'village', contextCode: '330101001001', total: 0, targets: [] }])
  assert.equal(calls, 0)
})

test('seat bundle resolves the same trusted coordinates as the seat index', async () => {
  const calls = []
  const upstream = {
    async qweather(module, lat, lon) { calls.push({ module, lat, lon }); const raw = module === 'hourly' ? hourlyPayload([30]) : currentPayload(26); return normalizeQWeather(module, raw) },
    async address() { throw new Error('off') },
  }
  const service = createWeatherService(config, { upstream })
  const request = service.parse(url('contextLevel=county&contextCode=330101&target=seat'))
  assert.deepEqual([request.lon, request.lat], [120.1, 30.1])
  const bundle = await service.bundle(request)
  assert.equal(bundle.target, 'seat'); assert.deepEqual(bundle.location, { lat: 30.1, lon: 120.1 })
  assert.equal(calls.find((c) => c.module === 'current').lat, 30.1)
})
