import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { createApiHzClient, UpstreamError } from './apihz-client.js'
import { createIpRateLimiter, createUpstreamBroker, ResourceLimitError } from './resource-manager.js'
import { createWeatherService } from './weather-service.js'
import { WeatherSpatialError } from './weather-spatial-index.js'
import { createNationalAlarmService, NationalAlarmError } from './national-alarm-service.js'

function beijingYear(now = Date.now()) { return new Date(now + 8 * 60 * 60 * 1000).getUTCFullYear() }
function responseAlive(response) { return !response.destroyed && !response.writableEnded }
function sendJson(response, status, payload, requestId) {
  if (!responseAlive(response)) return false
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-request-id': requestId,
  })
  response.end(body)
  return true
}
function publicError(error) {
  if (error instanceof ResourceLimitError) return { status: 503, code: 'SERVICE_BUSY', message: '台风数据服务繁忙，请稍后重试' }
  if (!(error instanceof UpstreamError)) return { status: 500, code: 'INTERNAL_ERROR', message: '服务内部错误' }
  switch (error.kind) {
    case 'unconfigured': return { status: 503, code: 'SERVICE_UNCONFIGURED', message: '台风数据服务尚未配置' }
    case 'timeout': return { status: 504, code: 'UPSTREAM_TIMEOUT', message: '台风数据服务响应超时' }
    case 'too-large': return { status: 502, code: 'UPSTREAM_RESPONSE_TOO_LARGE', message: '台风数据服务响应异常' }
    default: return { status: 502, code: 'UPSTREAM_ERROR', message: '台风数据服务暂时不可用' }
  }
}
function safeLog(logger, level, entry) { const method = logger?.[level]; if (typeof method === 'function') method.call(logger, entry) }
function isLoopback(address) { return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' }
function weatherRequestError(error) {
  if (!(error instanceof WeatherSpatialError)) return null
  if (error.kind === 'outside') return { status: 400, code: 'WEATHER_LOCATION_OUT_OF_ZHEJIANG', message: '天气当前仅支持浙江省范围' }
  if (error.kind === 'unconfigured') return { status: 503, code: 'WEATHER_SERVICE_UNCONFIGURED', message: '天气空间服务尚未配置' }
  return { status: 400, code: 'INVALID_WEATHER_REQUEST', message: '天气请求参数无效' }
}
function nationalAlarmError(error) {
  if (!(error instanceof NationalAlarmError)) return null
  if (error.kind === 'not-found') return { status: 404, code: 'NATIONAL_ALARM_NOT_FOUND', message: '浙江预警记录不存在' }
  if (error.kind === 'detail-unavailable') return { status: 502, code: 'NATIONAL_ALARM_DETAIL_UNAVAILABLE', message: '预警正文暂不可用' }
  return { status: 503, code: 'NATIONAL_ALARM_UNAVAILABLE', message: '浙江预警数据暂不可用' }
}
function noBody(request) { return !Number(request.headers['content-length'] ?? 0) && !request.headers['transfer-encoding'] }

export function createAppServer(config, options = {}) {
  const client = createApiHzClient(config, options)
  const logger = options.logger ?? console
  const now = options.now ?? Date.now
  const broker = options.broker ?? createUpstreamBroker({
    maxConcurrency: config.upstreamConcurrency ?? 6,
    cacheTtlMs: config.cacheTtlMs ?? 30_000,
    cacheMaxEntries: config.cacheMaxEntries ?? 128,
    now,
  })
  const weather = options.weatherService ?? createWeatherService(config.weather ?? {}, options.weatherOptions ?? options)
  const nationalAlarms = options.nationalAlarmService ?? createNationalAlarmService(config.nationalAlarms ?? {}, options.nationalAlarmOptions ?? options)
  const rateLimiter = options.rateLimiter ?? createIpRateLimiter({
    limit: config.rateLimitPerMinute ?? 60,
    windowMs: 60_000,
    maxClients: config.rateLimitMaxClients ?? 2048,
    now,
  })
  return http.createServer(async (request, response) => {
    const requestId = randomUUID()
    const startedAt = Date.now()
    let status = 500
    let routeName = 'not-found'
    let subscription = null
    let weatherController = null
    let clientGone = false
    const onGone = () => {
      if (response.writableEnded) return
      clientGone = true
      subscription?.release()
      weatherController?.abort()
    }
    request.once('aborted', onGone)
    response.once('close', onGone)
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (url.pathname === '/healthz' && request.method === 'GET') { routeName = 'healthz'; status = 200; sendJson(response, status, { ok: true, configured: Boolean(config.developerId && config.key) }, requestId); return }
      if (url.pathname === '/api/weather/cache' && request.method === 'DELETE') {
        routeName = 'weather-cache-clear'
        const token = request.headers['x-weather-admin-token']
        if (!isLoopback(request.socket.remoteAddress) || !config.weather?.adminToken || token !== config.weather.adminToken || url.search) { status = 403; sendJson(response, status, { error: { code: 'FORBIDDEN', message: '无权清除天气缓存', requestId } }, requestId); return }
        weather.clearCache(); status = 204; response.writeHead(status, { 'cache-control': 'no-store', 'x-request-id': requestId }); response.end(); return
      }
      if (url.pathname === '/api/national-weather-alarms/refresh') {
        routeName = 'national-alarm-refresh'
        if (request.method !== 'POST') { status = 405; sendJson(response, status, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 POST 请求', requestId } }, requestId); return }
        if (url.search || !noBody(request)) { status = 400; sendJson(response, status, { error: { code: 'INVALID_NATIONAL_ALARM_REQUEST', message: '预警刷新请求参数无效', requestId } }, requestId); return }
        try { const payload = await nationalAlarms.forceRefresh(); status = 200; sendJson(response, status, payload, requestId); return } catch (error) { const mapped = nationalAlarmError(error); if (!mapped) throw error; status = mapped.status; sendJson(response, status, { error: { code: mapped.code, message: mapped.message, requestId } }, requestId); return }
      }
      if (url.pathname === '/api/national-weather-alarms' && request.method !== 'GET') {
        routeName = 'national-alarm-list'; status = 405; sendJson(response, status, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET 请求', requestId } }, requestId); return
      }
      if (url.pathname === '/api/national-weather-alarms' && request.method === 'GET') {
        routeName = 'national-alarm-list'
        if (url.search) { status = 400; sendJson(response, status, { error: { code: 'INVALID_NATIONAL_ALARM_REQUEST', message: '预警列表请求参数无效', requestId } }, requestId); return }
        try { const payload = await nationalAlarms.list(); status = 200; sendJson(response, status, payload, requestId); return } catch (error) { const mapped = nationalAlarmError(error); if (!mapped) throw error; status = mapped.status; sendJson(response, status, { error: { code: mapped.code, message: mapped.message, requestId } }, requestId); return }
      }
      const nationalDetail = url.pathname.match(/^\/api\/national-weather-alarms\/([^/]+)$/)
      if (nationalDetail && request.method !== 'GET') { routeName = 'national-alarm-detail'; status = 405; sendJson(response, status, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET 请求', requestId } }, requestId); return }
      if (nationalDetail && request.method === 'GET') {
        routeName = 'national-alarm-detail'
        let alertId
        try { alertId = decodeURIComponent(nationalDetail[1]) } catch { status = 400; sendJson(response, status, { error: { code: 'INVALID_NATIONAL_ALARM_REQUEST', message: '预警详情请求参数无效', requestId } }, requestId); return }
        if (url.search || !/^[^\u0000-\u001F]{1,128}$/.test(alertId)) { status = 400; sendJson(response, status, { error: { code: 'INVALID_NATIONAL_ALARM_REQUEST', message: '预警详情请求参数无效', requestId } }, requestId); return }
        try { const payload = await nationalAlarms.detail(alertId); status = 200; sendJson(response, status, payload, requestId); return } catch (error) { const mapped = nationalAlarmError(error); if (!mapped) throw error; status = mapped.status; sendJson(response, status, { error: { code: mapped.code, message: mapped.message, requestId } }, requestId); return }
      }
      if (request.method !== 'GET') { status = 405; sendJson(response, status, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET 请求', requestId } }, requestId); return }
      const ip = request.socket.remoteAddress ?? 'unknown'
      if (!rateLimiter.consume(ip)) { status = 429; sendJson(response, status, { error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试', requestId } }, requestId); return }
      if (url.pathname === '/api/weather/markers') {
        routeName = 'weather-markers'
        try {
          const markersRequest = weather.parseMarkers(url)
          weatherController = new AbortController()
          const stream = weather.markers(markersRequest, weatherController.signal)
          response.writeHead(200, {
            'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store',
            'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-request-id': requestId,
          })
          for await (const event of stream) {
            if (clientGone || !responseAlive(response)) break
            response.write(`${JSON.stringify(event)}\n`)
          }
          status = 200
          response.end()
          return
        } catch (error) {
          const mapped = weatherRequestError(error)
          if (!mapped) throw error
          if (response.headersSent) { response.destroy(); return }
          status = mapped.status; sendJson(response, status, { error: { code: mapped.code, message: mapped.message, requestId } }, requestId); return
        }
      }
      if (url.pathname === '/api/weather') {
        routeName = 'weather'
        try {
          const weatherRequest = weather.parse(url)
          weatherController = new AbortController()
          const payload = await weather.bundle(weatherRequest, weatherController.signal)
          if (clientGone) return
          status = 200; sendJson(response, status, payload, requestId); return
        } catch (error) {
          const mapped = weatherRequestError(error)
          if (!mapped) throw error
          status = mapped.status; sendJson(response, status, { error: { code: mapped.code, message: mapped.message, requestId } }, requestId); return
        }
      }
      let key
      let loader
      if (url.pathname === '/api/typhoons') {
        routeName = 'typhoon-list'
        const years = url.searchParams.getAll('year')
        if (years.length !== 1 || [...url.searchParams.keys()].some((name) => name !== 'year') || !/^\d{4}$/.test(years[0])) { status = 400; sendJson(response, status, { error: { code: 'INVALID_YEAR', message: 'year 必须是唯一的四位年份参数', requestId } }, requestId); return }
        const year = Number(years[0])
        if (year < 2000 || year > beijingYear(now())) { status = 400; sendJson(response, status, { error: { code: 'INVALID_YEAR', message: 'year 超出可查询范围', requestId } }, requestId); return }
        key = `list:${year}`
        loader = (signal) => client.list(year, signal)
      } else {
        const match = url.pathname.match(/^\/api\/typhoons\/([^/]+)$/)
        if (!match) { status = 404; sendJson(response, status, { error: { code: 'NOT_FOUND', message: '接口不存在', requestId } }, requestId); return }
        routeName = 'typhoon-detail'
        if (url.search || !/^\d{1,32}$/.test(match[1])) { status = 400; sendJson(response, status, { error: { code: 'INVALID_TYPHOON_NO', message: '台风编号格式无效', requestId } }, requestId); return }
        key = `detail:${match[1]}`
        loader = (signal) => client.detail(match[1], signal)
      }
      subscription = broker.subscribe(key, loader)
      const payload = await subscription.promise
      if (clientGone) return
      status = 200
      sendJson(response, status, payload, requestId)
    } catch (error) {
      if (clientGone) return
      const mapped = publicError(error); status = mapped.status
      sendJson(response, status, { error: { code: mapped.code, message: mapped.message, requestId } }, requestId)
    } finally {
      subscription?.release()
      request.off('aborted', onGone)
      response.off('close', onGone)
      safeLog(logger, status >= 500 ? 'error' : 'info', { requestId, method: request.method, route: routeName, status, durationMs: Date.now() - startedAt })
    }
  })
}
