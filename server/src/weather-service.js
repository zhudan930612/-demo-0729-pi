import { createHash } from 'node:crypto'
import { loadWeatherSpatialIndex, WeatherSpatialError } from './weather-spatial-index.js'
import { createWeatherUpstream } from './weather-upstream.js'
import { createWeatherCache, publicModuleError } from './weather-cache.js'

const LEVELS = new Set(['province', 'city', 'county', 'township', 'village'])
const TARGETS = new Set(['admin', 'parcel', 'picked'])
function strictOne(params, name) { const values = params.getAll(name); return values.length === 1 ? values[0] : null }
function coordinate(value, min, max) { if (typeof value !== 'string' || value.trim() === '') return null; const number = Number(value); return Number.isFinite(number) && number >= min && number <= max ? number : null }
function round2(value) { return Math.round((value + Number.EPSILON) * 100) / 100 }
function keyCoordinate(value) { return Object.is(value, -0) ? '0' : String(value) }
function moduleState(result, emptyMessage) {
  if (result.error) return { status: 'error', error: result.error }
  const timing = { fetchedAt: result.value.fetchedAt, expiresAt: result.value.expiresAt, ...(result.value.stale ? { stale: true, refreshError: result.value.refreshError } : {}) }
  if (result.value?.empty || (Array.isArray(result.value?.data) && result.value.data.length === 0)) return { status: 'empty', data: result.value.data, message: emptyMessage, metadata: result.value.metadata, ...timing }
  return { status: 'success', data: result.value.data, metadata: result.value.metadata, ...timing }
}
async function settle(factoryOrSubscription, externalSignal) {
  let subscription
  try { subscription = typeof factoryOrSubscription === 'function' ? factoryOrSubscription() : factoryOrSubscription } catch (error) { return { error: publicModuleError(error) } }
  const release = () => subscription.release()
  externalSignal?.addEventListener('abort', release, { once: true }); if (externalSignal?.aborted) release()
  try { return { value: await subscription.promise } } catch (error) { return { error: publicModuleError(error) } } finally { externalSignal?.removeEventListener('abort', release); release() }
}

export function parseWeatherRequest(url, spatial) {
  const allowed = new Set(['contextLevel', 'contextCode', 'target', 'lat', 'lon'])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) throw new WeatherSpatialError('parameters', '天气请求包含未知参数')
  const contextLevel = strictOne(url.searchParams, 'contextLevel'), contextCode = strictOne(url.searchParams, 'contextCode'), target = strictOne(url.searchParams, 'target')
  if (!LEVELS.has(contextLevel) || !/^\d{6,12}$/.test(contextCode ?? '') || !TARGETS.has(target)) throw new WeatherSpatialError('parameters', '天气请求参数无效')
  const node = spatial.get(contextCode, contextLevel)
  const hasLat = url.searchParams.has('lat'), hasLon = url.searchParams.has('lon')
  if (target === 'admin') {
    if (hasLat || hasLon) throw new WeatherSpatialError('parameters', '行政天气不接受自报坐标')
    return { contextLevel, contextCode, target, node, lon: node.representativePoint[0], lat: node.representativePoint[1] }
  }
  const lat = strictOne(url.searchParams, 'lat'), lon = strictOne(url.searchParams, 'lon')
  const parsedLat = coordinate(lat, -90, 90), parsedLon = coordinate(lon, -180, 180)
  if (!hasLat || !hasLon || parsedLat === null || parsedLon === null) throw new WeatherSpatialError('parameters', '天气坐标参数无效')
  if (target === 'parcel') {
    if (contextLevel !== 'village' || !spatial.covers(node, parsedLon, parsedLat)) throw new WeatherSpatialError('outside', '地块坐标与浙江村界不一致')
  } else if (!spatial.covers(spatial.province(), parsedLon, parsedLat)) throw new WeatherSpatialError('outside', '点选坐标不在浙江省真实边界内')
  return { contextLevel, contextCode, target, node, lon: parsedLon, lat: parsedLat }
}

export function createWeatherService(config, options = {}) {
  let spatial
  const loadSpatial = options.loadSpatial ?? loadWeatherSpatialIndex
  function getSpatial() { if (!spatial) spatial = loadSpatial(config.dataDir); return spatial }
  const upstream = options.upstream ?? createWeatherUpstream(config, options)
  const cache = options.cache ?? createWeatherCache({ now: options.now, random: options.random, maxEntries: config.cacheMaxEntries, maxConcurrency: config.upstreamConcurrency, ttls: options.ttls })
  function qSubscription(module, lat, lon) {
    const roundedLat = round2(lat), roundedLon = round2(lon), key = `${module}:${keyCoordinate(roundedLat)},${keyCoordinate(roundedLon)}:zh:true${module === 'hourly' ? ':24' : ''}`
    return cache.subscribe(module, key, (signal) => upstream.qweather(module, roundedLat, roundedLon, signal))
  }
  function addressSubscription(lon, lat) {
    const coordinateKey = `${keyCoordinate(lon)},${keyCoordinate(lat)}`
    const key = `address:${createHash('sha256').update(coordinateKey).digest('hex')}`
    return cache.subscribe('address', key, (signal) => upstream.address(lon, lat, signal))
  }
  async function alerts(node, externalSignal) {
    const targets = getSpatial().alertNodes(node)
    if (targets.length === 0) return { status: 'empty', data: [], message: '天气预警查看到县级' }
    const regions = await Promise.all(targets.map(async (target) => {
      const result = await settle(() => qSubscription('alert', target.representativePoint[1], target.representativePoint[0]), externalSignal)
      if (result.error) return { code: target.code, name: target.name, point: target.representativePoint, status: 'error', error: result.error }
      const timing = { fetchedAt: result.value.fetchedAt, expiresAt: result.value.expiresAt, ...(result.value.stale ? { stale: true, refreshError: result.value.refreshError } : {}) }
      return { code: target.code, name: target.name, point: target.representativePoint, status: result.value.data.length ? 'success' : 'empty', alerts: result.value.data, metadata: result.value.metadata, ...timing }
    }))
    const byId = new Map()
    for (const region of regions) for (const alert of region.alerts ?? []) { const existing = byId.get(alert.id); if (existing) existing.matchedContextCodes.push(region.code); else byId.set(alert.id, { ...alert, matchedContextCodes: [region.code] }) }
    const allEmpty = regions.every((r) => r.status === 'empty'), allError = regions.every((r) => r.status === 'error'), anyError = regions.some((r) => r.status === 'error')
    return { status: allEmpty ? 'empty' : allError ? 'error' : anyError ? 'partial' : 'success', data: regions, details: [...byId.values()], ...(allEmpty ? { message: '当前层级各代表点未查询到生效天气预警' } : {}) }
  }
  return {
    parse(url) { return parseWeatherRequest(url, getSpatial()) },
    async bundle(request, externalSignal) {
      const rounded = { lat: round2(request.lat), lon: round2(request.lon) }
      const [current, minutely, hourly, address, alertResult] = await Promise.all([
        settle(() => qSubscription('current', request.lat, request.lon), externalSignal), settle(() => qSubscription('minutely', request.lat, request.lon), externalSignal), settle(() => qSubscription('hourly', request.lat, request.lon), externalSignal), settle(() => addressSubscription(request.lon, request.lat), externalSignal), alerts(request.node, externalSignal),
      ])
      return { contextLevel: request.contextLevel, contextCode: request.contextCode, target: request.target, location: rounded, originalLocation: { lat: request.lat, lon: request.lon }, fetchedAt: new Date((options.now ?? Date.now)()).toISOString(), address: moduleState(address, '地址增强暂无结果'), current: moduleState(current, '实时天气暂无结果'), alerts: alertResult, minutely: moduleState(minutely, '当前查询位置暂无分钟级降水预报'), hourly: moduleState(hourly, '未来 24 小时预报暂无结果'), attributions: [...(current.value?.metadata?.attributions ?? []), ...(hourly.value?.metadata?.attributions ?? [])] }
    },
    clearCache() { cache.clear() },
    stats() { return cache.stats() },
  }
}
