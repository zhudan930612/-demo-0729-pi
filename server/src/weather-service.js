import { createHash } from 'node:crypto'
import { loadWeatherSpatialIndex, WeatherSpatialError } from './weather-spatial-index.js'
import { loadWeatherSeatIndex } from './weather-seat-index.js'
import { createWeatherUpstream } from './weather-upstream.js'
import { createWeatherCache, publicModuleError } from './weather-cache.js'

const LEVELS = new Set(['province', 'city', 'county', 'township', 'village'])
const TARGETS = new Set(['admin', 'parcel', 'picked', 'seat'])
// 政府驻地标牌只存在于市/县/乡镇（省级不显示浙江省自身标牌；村/地块无驻地表目标）。
const SEAT_LEVELS = new Set(['city', 'county', 'township'])
const MARKER_CONCURRENCY = 4
function strictOne(params, name) { const values = params.getAll(name); return values.length === 1 ? values[0] : null }
function coordinate(value, min, max) { if (typeof value !== 'string' || value.trim() === '') return null; const number = Number(value); return Number.isFinite(number) && number >= min && number <= max ? number : null }
function round2(value) { return Math.round((value + Number.EPSILON) * 100) / 100 }
function keyCoordinate(value) { return Object.is(value, -0) ? '0' : String(value) }
function attributionKey(value) { return `${value?.url ?? ''}\u0000${value?.name ?? ''}` }
function mergeAttributions(...groups) {
  const merged = new Map()
  for (const value of groups.flat()) if (value && (value.name || value.url)) merged.set(attributionKey(value), value)
  return [...merged.values()]
}
function referAttributions(refer) {
  return [...(refer?.sources ?? []), ...(refer?.license ?? [])].map((value) => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? { name: null, url: value } : { name: value, url: null } } catch { return { name: value, url: null } }
  })
}
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

export function parseWeatherRequest(url, spatial, seatIndex) {
  const allowed = new Set(['contextLevel', 'contextCode', 'target', 'lat', 'lon'])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) throw new WeatherSpatialError('parameters', '天气请求包含未知参数')
  const contextLevel = strictOne(url.searchParams, 'contextLevel'), contextCode = strictOne(url.searchParams, 'contextCode'), target = strictOne(url.searchParams, 'target')
  if (!LEVELS.has(contextLevel) || !/^\d{6,12}$/.test(contextCode ?? '') || !TARGETS.has(target)) throw new WeatherSpatialError('parameters', '天气请求参数无效')
  const node = spatial.get(contextCode, contextLevel)
  const hasLat = url.searchParams.has('lat'), hasLon = url.searchParams.has('lon')
  if (target === 'seat') {
    if (hasLat || hasLon) throw new WeatherSpatialError('parameters', '驻地天气不接受自报坐标')
    if (!SEAT_LEVELS.has(contextLevel)) throw new WeatherSpatialError('parameters', '驻地天气只支持市/县/乡镇')
    const seat = seatIndex ? seatIndex.seatFor(node) : null
    if (!seat) throw new WeatherSpatialError('parameters', '该行政对象没有可用的政府驻地')
    return { contextLevel, contextCode, target, node, lon: seat.point[0], lat: seat.point[1], seat }
  }
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

export function parseWeatherMarkersRequest(url, spatial) {
  const allowed = new Set(['contextLevel', 'contextCode'])
  if ([...url.searchParams.keys()].some((key) => !allowed.has(key))) throw new WeatherSpatialError('parameters', '天气标牌请求包含未知参数')
  const contextLevel = strictOne(url.searchParams, 'contextLevel'), contextCode = strictOne(url.searchParams, 'contextCode')
  if (!LEVELS.has(contextLevel) || !/^\d{6,12}$/.test(contextCode ?? '')) throw new WeatherSpatialError('parameters', '天气标牌请求参数无效')
  const node = spatial.get(contextCode, contextLevel)
  return { contextLevel, contextCode, node }
}

function markerSummary(current, hourly) {
  // 仅返回标牌所需字段：当前天气现象/温度 + 由逐小时计算的未来 24 小时最高/最低（整数）。
  const currentOk = current?.status === 'success' && current.data != null
  const hourlyOk = hourly?.status === 'success' && Array.isArray(hourly.data) && hourly.data.length > 0
  const items = hourlyOk ? hourly.data : []
  const temperatures = items.map((item) => item.temperature?.value).filter((value) => typeof value === 'number' && Number.isFinite(value))
  const hourlyUnit = items.find((item) => item.temperature?.unit)?.temperature?.unit ?? null
  const temperature = currentOk ? { value: current.data.temperature.value, unit: current.data.temperature.unit } : null
  const condition = currentOk ? { code: current.data.condition.code, text: current.data.condition.text } : null
  const high = temperatures.length ? { value: Math.round(Math.max(...temperatures)), unit: hourlyUnit } : null
  const low = temperatures.length ? { value: Math.round(Math.min(...temperatures)), unit: hourlyUnit } : null
  return { condition, temperature, high, low, fetchedAt: (currentOk && current.fetchedAt) ? current.fetchedAt : (hourlyOk && hourly.fetchedAt) ? hourly.fetchedAt : new Date().toISOString() }
}

function markerError(current, hourly) {
  return current?.error ?? hourly?.error ?? { code: 'WEATHER_UPSTREAM_ERROR', message: '天气模块暂时不可用' }
}

export function createWeatherService(config, options = {}) {
  let spatial
  const loadSpatial = options.loadSpatial ?? loadWeatherSpatialIndex
  function getSpatial() { if (!spatial) spatial = loadSpatial(config.dataDir); return spatial }
  let seatIndex
  const loadSeatIndex = options.loadSeatIndex ?? (() => loadWeatherSeatIndex(config.dataDir, config.seatsFile))
  function getSeatIndex() { if (!seatIndex) seatIndex = loadSeatIndex(); return seatIndex }
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
  // NMC 浙江预警已独立接管；实时天气不再请求和风预警，避免混用两套空间语义。
  async function alerts() { return { status: 'empty', data: [], message: '气象预警请使用浙江省气象预警入口' } }
  return {
    parse(url) {
      // 政府驻地索引只在地图标牌点击（target=seat）时才懒加载，避免影响普通请求。
      const target = url.searchParams.get('target')
      return parseWeatherRequest(url, getSpatial(), target === 'seat' ? getSeatIndex() : undefined)
    },
    parseMarkers(url) { return parseWeatherMarkersRequest(url, getSpatial()) },
    markers(request, externalSignal) {
      const seatIndex = getSeatIndex()
      const { targets } = seatIndex.children(request.node)
      const controller = new AbortController()
      const onAbort = () => controller.abort()
      externalSignal?.addEventListener('abort', onAbort, { once: true }); if (externalSignal?.aborted) controller.abort()
      const skeleton = targets.map((target) => ({ code: target.code, level: target.level, name: target.name, location: { lat: target.point[1], lon: target.point[0] } }))
      async function* stream() {
        yield { type: 'targets', contextLevel: request.contextLevel, contextCode: request.contextCode, total: skeleton.length, targets: skeleton }
        for (let i = 0; i < targets.length && !controller.signal.aborted; i += MARKER_CONCURRENCY) {
          const chunk = targets.slice(i, i + MARKER_CONCURRENCY)
          const events = await Promise.all(chunk.map(async (target) => {
            const [current, hourly] = await Promise.all([
              settle(() => qSubscription('current', target.point[1], target.point[0]), controller.signal),
              settle(() => qSubscription('hourly', target.point[1], target.point[0]), controller.signal),
            ])
            const currentState = moduleState(current, '实时天气暂无结果')
            const hourlyState = moduleState(hourly, '未来 24 小时预报暂无结果')
            if (currentState.status === 'error' && hourlyState.status === 'error') return { type: 'error', code: target.code, error: markerError(currentState, hourlyState) }
            return { type: 'ready', code: target.code, summary: markerSummary(currentState, hourlyState) }
          }))
          for (const event of events) {
            if (controller.signal.aborted) return
            yield event
          }
        }
      }
      return {
        [Symbol.asyncIterator]: stream,
        cancel() { controller.abort() },
      }
    },
    async bundle(request, externalSignal) {
      const rounded = { lat: round2(request.lat), lon: round2(request.lon) }
      const [current, minutely, hourly, address, alertResult] = await Promise.all([
        settle(() => qSubscription('current', request.lat, request.lon), externalSignal), settle(() => qSubscription('minutely', request.lat, request.lon), externalSignal), settle(() => qSubscription('hourly', request.lat, request.lon), externalSignal), settle(() => addressSubscription(request.lon, request.lat), externalSignal), alerts(request.node, externalSignal),
      ])
      const attributions = mergeAttributions(
        current.value?.metadata?.attributions ?? [], hourly.value?.metadata?.attributions ?? [],
        alertResult.data?.flatMap((region) => region.metadata?.attributions ?? []) ?? [],
        referAttributions(minutely.value?.metadata?.refer),
      )
      return { contextLevel: request.contextLevel, contextCode: request.contextCode, target: request.target, location: rounded, originalLocation: { lat: request.lat, lon: request.lon }, fetchedAt: new Date((options.now ?? Date.now)()).toISOString(), address: moduleState(address, '地址增强暂无结果'), current: moduleState(current, '实时天气暂无结果'), alerts: alertResult, minutely: moduleState(minutely, '当前查询位置暂无分钟级降水预报'), hourly: moduleState(hourly, '未来 24 小时预报暂无结果'), attributions }
    },
    clearCache() { cache.clear() },
    stats() { return cache.stats() },
  }
}
