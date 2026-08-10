import { WeatherUpstreamError } from './weather-upstream.js'

// 浙江 0.25° 网格：118.0–123.0E × 27.0–31.5N，21×19 = 399 点（单请求 ≤1000 位上限内，实测可用）
export const PRECIP_GRID = Object.freeze({
  lonMin: 118.0, lonMax: 123.0, latMin: 27.0, latMax: 31.5, step: 0.25,
})
// Open-Meteo 时间序列从北京时间今日 0:00 起；192 小时 = 8 个自然日，
// 保证从"当前整点小时"起聚合未来 7×24 小时时序列始终完整（最坏情况当前 23:00 → 起点索引 24 → 需 24+168=192）。
export const PRECIP_FORECAST_HOURS = 192
export const PRECIP_DAYS = 7
export const PRECIP_TTL_MS = 30 * 60 * 1000
export const PRECIP_MODEL = 'ECMWF IFS 0.25°'
const UPSTREAM_URL = 'https://api.open-meteo.com/v1/forecast'
const UPSTREAM_MODEL = 'ecmwf_ifs025'
const MAX_RESPONSE_BYTES = 48 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 60_000

export class PrecipitationError extends Error {
  constructor(kind, message, options = {}) { super(message); this.name = 'PrecipitationError'; this.kind = kind; this.status = options.status }
}

function round3(value) { return Math.round((value + Number.EPSILON) * 1000) / 1000 }
function round1(value) { return Math.round((value + Number.EPSILON) * 10) / 10 }

export function buildGridPoints() {
  const lons = [], lats = []
  for (let lon = PRECIP_GRID.lonMin; lon <= PRECIP_GRID.lonMax + 1e-9; lon += PRECIP_GRID.step) lons.push(round3(lon))
  for (let lat = PRECIP_GRID.latMin; lat <= PRECIP_GRID.latMax + 1e-9; lat += PRECIP_GRID.step) lats.push(round3(lat))
  // Open-Meteo 多位置语法：latitude/longitude 按索引配对，同一批内纬度在外层、经度在内层
  const latParam = lats.flatMap((lat) => lons.map(() => String(lat))).join(',')
  const lonParam = lats.flatMap(() => lons.map((lon) => String(lon))).join(',')
  return { lons, lats, latParam, lonParam, pointCount: lats.length * lons.length }
}

/**
 * 将逐小时数组按段聚合为 7 段日累计（d1..d7），从 startIndex 起每 24 小时求和。
 * 序列不足对应段时该段及之后不写（返回实际覆盖天数 coveredDays），不补 0。
 */
export function aggregateDaily(values, hours, startIndex) {
  let covered = 0
  for (let day = 0; day < PRECIP_DAYS; day++) {
    const from = startIndex + day * 24
    if (from >= hours.length) break
    const upto = Math.min(from + 24, hours.length)
    let sum = 0
    for (let i = from; i < upto; i++) {
      const value = hours[i]
      if (typeof value === 'number' && Number.isFinite(value)) sum += value
    }
    values[`d${day + 1}`] = round1(sum)
    covered = day + 1
  }
  return covered
}

/**
 * 面状降水预报服务：固定拉取浙江 0.25° 网格未来预报逐小时降水，
 * 聚合 7 段日累计，单键缓存 30 分钟，合并在途请求；上游失败且有旧快照时返回 stale 快照。
 */
export function createPrecipitationService(config = {}, options = {}) {
  const now = options.now ?? Date.now
  const fetchImpl = options.fetchImpl ?? fetch
  const grid = buildGridPoints()
  let cache = null
  let inFlight = null

  async function fetchUpstream(signal) {
    const params = new URLSearchParams()
    params.set('latitude', grid.latParam)
    params.set('longitude', grid.lonParam)
    params.set('hourly', 'precipitation')
    params.set('forecast_hours', String(PRECIP_FORECAST_HOURS))
    params.set('timezone', 'Asia/Shanghai')
    params.set('models', UPSTREAM_MODEL)
    const url = `${UPSTREAM_URL}?${params.toString()}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new PrecipitationError('timeout', '降水网格上游响应超时')), REQUEST_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      let response
      try {
        response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'agri-insurance-demo/1.0' } })
      } catch (error) {
        if (error?.name === 'AbortError') {
          if (controller.signal.reason instanceof PrecipitationError) throw controller.signal.reason
          throw new PrecipitationError(signal?.aborted ? 'aborted' : 'timeout', signal?.aborted ? '降水网格请求已取消' : '降水网格上游响应超时')
        }
        throw new PrecipitationError('network', '降水网格上游网络错误')
      }
      if (!response.ok) throw new PrecipitationError('http', `降水网格上游返回 ${response.status}`, { status: response.status })
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > MAX_RESPONSE_BYTES) throw new PrecipitationError('too-large', '降水网格上游响应过大')
      const raw = await response.text()
      if (raw.length > MAX_RESPONSE_BYTES) throw new PrecipitationError('too-large', '降水网格上游响应过大')
      let payload
      try { payload = JSON.parse(raw) } catch { throw new PrecipitationError('structure', '降水网格响应结构异常') }
      if (!Array.isArray(payload) || payload.length !== grid.pointCount) throw new PrecipitationError('structure', '降水网格点数与请求不符')
      return payload
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  function normalize(payload, stamp) {
    let refTimes = null
    for (const item of payload) {
      const valid = item && typeof item.latitude === 'number' && typeof item.longitude === 'number'
        && Array.isArray(item.hourly?.time) && Array.isArray(item.hourly?.precipitation)
      if (!valid) throw new PrecipitationError('structure', '降水网格单项结构异常')
      if (refTimes === null) refTimes = item.hourly.time
      else if (refTimes.length !== item.hourly.time.length) throw new PrecipitationError('structure', '降水网格时次长度不一致')
    }
    if (!refTimes || refTimes.length < 24) throw new PrecipitationError('structure', '降水网格时次不足')

    // 聚合口径（2026-08-10 用户实测后修正）：自然日累计——从北京时间今日 0:00 起每 24h 一段，
    // 含今日已过时次（与用户期望的"今天累计"及参考图"未来24小时"口径一致）
    const aggregateFromMs = stamp - ((stamp + 8 * 3600 * 1000) % 86400_000) // 北京今日 0:00（UTC 毫秒）
    const startIndex = 0
    const aggregateFrom = new Date(aggregateFromMs + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + '+08:00'

    const gridData = []
    let coveredDays = 0
    for (const item of payload) {
      const values = {}
      coveredDays = Math.max(coveredDays, aggregateDaily(values, item.hourly.precipitation, startIndex))
      gridData.push({ lat: round3(item.latitude), lon: round3(item.longitude), values })
    }
    const dayBase = new Date(aggregateFromMs + 8 * 3600 * 1000)
    const days = []
    for (let i = 0; i < PRECIP_DAYS; i++) days.push(new Date(dayBase.getTime() + i * 24 * 3600_000).toISOString().slice(0, 10))

    return { grid: gridData, days, coveredDays, model: PRECIP_MODEL, updatedAt: new Date(stamp + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + '+08:00', aggregateFrom }
  }

  function staleValue(error) { return { ...cache.value, stale: true, refreshError: error.message } }

  async function snapshot(signal) {
    const stamp = now()
    if (cache && cache.expiresAt > stamp) return cache.value
    if (inFlight) {
      try { return await inFlight.promise } catch (error) { if (error?.kind !== 'aborted' && cache) return staleValue(error); throw error }
    }
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const promise = (async () => {
      const payload = await fetchUpstream(controller.signal)
      const value = normalize(payload, now())
      cache = { value, expiresAt: now() + PRECIP_TTL_MS }
      return value
    })().finally(() => { inFlight = null; signal?.removeEventListener('abort', onAbort) })
    inFlight = { promise, controller }
    try { return await promise } catch (error) {
      if (error?.kind !== 'aborted' && cache) return staleValue(error)
      throw error
    }
  }

  function clearCache() { cache = null }

  return { snapshot, clearCache, grid }
}

/** 将 PrecipitationError 映射为可下发的公开错误（供 app.js 使用）。 */
export function precipitationError(error) {
  if (!(error instanceof PrecipitationError)) return null
  if (error.kind === 'http' && error.status === 429) return { status: 502, code: 'PRECIP_UPSTREAM_BUSY', message: '降水预报上游繁忙，请稍后重试' }
  if (error.kind === 'timeout') return { status: 504, code: 'PRECIP_UPSTREAM_TIMEOUT', message: '降水预报数据响应超时' }
  if (error.kind === 'too-large') return { status: 502, code: 'PRECIP_UPSTREAM_TOO_LARGE', message: '降水预报数据响应异常' }
  return { status: 502, code: 'PRECIP_UNAVAILABLE', message: '降水预报数据暂不可用' }
}

export function isWeatherUpstreamError(error) { return error instanceof WeatherUpstreamError }
