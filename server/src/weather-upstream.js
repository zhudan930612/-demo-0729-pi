import http from 'node:http'
import https from 'node:https'
import { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

export class WeatherUpstreamError extends Error {
  constructor(kind, message, options = {}) { super(message); this.name = 'WeatherUpstreamError'; this.kind = kind; this.status = options.status; this.retryAfterMs = options.retryAfterMs; this.metrics = options.metrics }
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function finite(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function ratio(value) { const number = finite(value); return number !== null && number >= 0 && number <= 1 ? number : null }
function text(value) { return typeof value === 'string' && value.trim() !== '' ? value : null }
function unitValue(value, required = false) { if (!object(value)) return required ? undefined : null; const normalized = { value: finite(value.value), unit: text(value.unit) }; return required && (normalized.value === null || !normalized.unit) ? undefined : normalized }
function condition(value, required = false) { if (!object(value)) return required ? undefined : null; const normalized = { code: text(value.code), text: text(value.text) }; return required && (!normalized.code || !normalized.text) ? undefined : normalized }
function attribution(value) { return object(value) ? { name: text(value.name), url: text(value.url) } : null }
function metadata(value) { return object(value) ? { tag: text(value.tag), zeroResult: value.zeroResult === true, attributions: Array.isArray(value.attributions) ? value.attributions.map(attribution).filter(Boolean) : [] } : { tag: null, zeroResult: false, attributions: [] } }
function iso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null }

export function normalizeQWeather(module, payload) {
  if (!object(payload)) throw new WeatherUpstreamError('structure', '天气响应结构异常')
  const meta = metadata(payload.metadata)
  if (module === 'current') {
    const current = payload.current, currentCondition = condition(current?.condition, true), temperature = unitValue(current?.temperature, true)
    if (!object(current) || !iso(current.observationTime) || !currentCondition || !temperature) throw new WeatherUpstreamError('structure', '实时天气响应结构异常')
    return { data: { observationTime: current.observationTime, condition: currentCondition, temperature, feelsLike: unitValue(current.feelsLike), precipitation: object(current.precipitation) ? { amount: unitValue(current.precipitation.amount), intensity: unitValue(current.precipitation.intensity), type: text(current.precipitation.type) } : null, humidity: ratio(current.humidity) }, metadata: meta }
  }
  if (module === 'hourly') {
    if (!Array.isArray(payload.hourly) || payload.hourly.length === 0) throw new WeatherUpstreamError('structure', '逐小时天气响应结构异常')
    return { data: payload.hourly.map((item) => {
      const itemCondition = condition(item?.condition, true), temperature = unitValue(item?.temperature, true)
      if (!object(item) || !iso(item.forecastTime) || !itemCondition || !temperature) throw new WeatherUpstreamError('structure', '逐小时天气项异常')
      return { forecastTime: item.forecastTime, condition: itemCondition, temperature, precipitation: object(item.precipitation) ? { probability: ratio(item.precipitation.probability), amount: unitValue(item.precipitation.amount) } : null }
    }).sort((a, b) => Date.parse(a.forecastTime) - Date.parse(b.forecastTime)), metadata: meta }
  }
  if (module === 'alert') {
    if (!Array.isArray(payload.alerts)) throw new WeatherUpstreamError('structure', '天气预警响应结构异常')
    const alerts = payload.alerts.map((item) => {
      if (!object(item) || !text(item.id)) throw new WeatherUpstreamError('structure', '天气预警项异常')
      const type = object(item.messageType) ? { code: text(item.messageType.code), supersedes: Array.isArray(item.messageType.supersedes) ? item.messageType.supersedes.filter((v) => text(v)) : [] } : { code: null, supersedes: [] }
      return { id: item.id, headline: text(item.headline), issuedTime: iso(item.issuedTime), urgency: text(item.urgency), severity: text(item.severity), certainty: text(item.certainty), description: text(item.description), criteria: text(item.criteria), instruction: text(item.instruction), senderName: text(item.senderName), messageType: type, eventType: object(item.eventType) ? { name: text(item.eventType.name), code: text(item.eventType.code) } : null, icon: text(item.icon), color: object(item.color) ? { code: text(item.color.code), red: finite(item.color.red), green: finite(item.color.green), blue: finite(item.color.blue), alpha: finite(item.color.alpha) } : null, effectiveTime: iso(item.effectiveTime), onsetTime: iso(item.onsetTime), expireTime: iso(item.expireTime), responseTypes: Array.isArray(item.responseTypes) ? item.responseTypes.filter((value) => text(value)) : [] }
    })
    const superseded = new Set(alerts.flatMap((item) => item.messageType.supersedes))
    return { data: alerts.filter((item) => !superseded.has(item.id) && item.messageType.code?.toLowerCase() !== 'cancel'), metadata: meta }
  }
  throw new WeatherUpstreamError('structure', '未知天气模块')
}

export function normalizeMinutely(payload) {
  if (!object(payload)) throw new WeatherUpstreamError('structure', '分钟降水响应结构异常')
  const refer = object(payload.refer) ? { sources: Array.isArray(payload.refer.sources) ? payload.refer.sources.filter((v) => text(v)) : [], license: Array.isArray(payload.refer.license) ? payload.refer.license.filter((v) => text(v)) : [] } : { sources: [], license: [] }
  if (!Array.isArray(payload.minutely)) { if (payload.code === '204') return { data: null, metadata: { ...metadata(null), refer }, empty: true }; throw new WeatherUpstreamError('structure', '分钟降水响应结构异常') }
  return { data: { updateTime: iso(payload.updateTime), summary: text(payload.summary), minutely: payload.minutely.map((item) => { if (!object(item) || !iso(item.fxTime) || finite(item.precip) === null) throw new WeatherUpstreamError('structure', '分钟降水项异常'); return { fxTime: item.fxTime, precip: item.precip, type: text(item.type) } }), refer }, metadata: { ...metadata(null), refer }, empty: payload.minutely.length === 0 }
}

function retryAfter(value, now) { if (!value) return null; const seconds = Number(value); if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000); const date = Date.parse(value); return Number.isFinite(date) ? Math.max(0, date - now()) : null }
function streamTransport(url, init) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const request = client.request(url, { method: init.method, headers: init.headers, signal: init.signal }, (response) => resolve({ status: response.statusCode, headers: response.headers, stream: response }))
    request.on('error', reject); request.end()
  })
}
function header(headers, name) { if (typeof headers?.get === 'function') return headers.get(name); const value = headers?.[name.toLowerCase()]; return Array.isArray(value) ? value.join(', ') : value == null ? null : String(value) }
async function decodeJson(response, networkMax, decodedMax) {
  const declared = Number(header(response.headers, 'content-length')); if (Number.isFinite(declared) && declared > networkMax) throw new WeatherUpstreamError('too-large', '天气响应超过网络大小限制')
  const encoding = (header(response.headers, 'content-encoding') ?? 'identity').trim().toLowerCase()
  const transforms = { gzip: createGunzip, br: createBrotliDecompress, deflate: createInflate }
  if (!['identity', 'gzip', 'br', 'deflate'].includes(encoding)) throw new WeatherUpstreamError('decompression', '天气响应编码不受支持')
  let networkBytes = 0, decodedBytes = 0
  const source = response.stream
  const decoded = encoding === 'identity' ? source : source.pipe(transforms[encoding]())
  const sourceError = new Promise((_, reject) => source.once('error', reject))
  source.on('data', (chunk) => { networkBytes += chunk.length; if (networkBytes > networkMax) source.destroy(new WeatherUpstreamError('too-large', '天气响应超过网络大小限制')) })
  const consume = (async () => { const chunks = []; for await (const chunk of decoded) { decodedBytes += chunk.length; if (decodedBytes > decodedMax) throw new WeatherUpstreamError('too-large', '天气响应解压后超过大小限制'); chunks.push(chunk) } return Buffer.concat(chunks) })()
  let bytes
  try { bytes = await Promise.race([consume, sourceError]) } catch (error) { if (error instanceof WeatherUpstreamError) throw error; throw new WeatherUpstreamError('decompression', '天气响应编码或解压异常') }
  try { return { payload: JSON.parse(bytes.toString('utf8')), metrics: { networkBytes, decodedBytes, contentEncoding: encoding } } } catch { throw new WeatherUpstreamError('json', '天气响应不是有效 JSON') }
}
function responseFromFetch(response) { return { status: response.status, headers: response.headers, stream: response.body ? Readable.fromWeb(response.body) : Readable.from([]) } }

export function createWeatherUpstream(config, options = {}) {
  const transport = options.transport ?? (options.fetchImpl ? async (url, init) => responseFromFetch(await options.fetchImpl(url, init)) : streamTransport)
  const now = options.now ?? Date.now
  async function request(url, headers, signal) {
    const controller = new AbortController(), abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort()
    const timer = setTimeout(abort, config.timeoutMs)
    try {
      const response = await transport(url, { method: 'GET', headers: { accept: 'application/json', 'accept-encoding': 'gzip, br, deflate', ...headers }, signal: controller.signal })
      if (!(response.status >= 200 && response.status < 300)) { const kind = response.status === 429 ? 'rate-limit' : [400, 401, 403].includes(response.status) ? 'authentication' : 'http'; throw new WeatherUpstreamError(kind, '天气上游请求失败', { status: response.status, retryAfterMs: retryAfter(header(response.headers, 'retry-after'), now) }) }
      return await decodeJson(response, config.maxNetworkBytes, config.maxDecodedBytes)
    } catch (error) { if (error instanceof WeatherUpstreamError) throw error; if (controller.signal.aborted || error?.name === 'AbortError') throw new WeatherUpstreamError('timeout', '天气上游响应超时'); throw new WeatherUpstreamError('network', '天气上游网络错误') } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  function qweather(module, lat, lon, signal) {
    if (config.authMode !== 'api-key' || !config.apiOrigin || !config.apiKey || !config.projectId || !config.credentialId) throw new WeatherUpstreamError('unconfigured', '和风天气未配置')
    let url
    if (module === 'minutely') { url = new URL('/v7/minutely/5m', config.apiOrigin); url.searchParams.set('location', `${lon},${lat}`); url.searchParams.set('lang', 'zh') }
    else { const route = module === 'alert' ? 'weatheralert/v1/current' : module === 'current' ? 'weather/v1/current' : 'weather/v1/hourly'; url = new URL(`/${route}/${lat}/${lon}`, config.apiOrigin); url.searchParams.set('lang', 'zh'); url.searchParams.set('localTime', 'true'); if (module === 'hourly') url.searchParams.set('hours', '24') }
    return request(url, { 'X-QW-Api-Key': config.apiKey }, signal).then(({ payload, metrics }) => ({ ...(module === 'minutely' ? normalizeMinutely(payload) : normalizeQWeather(module, payload)), metrics }))
  }
  async function address(lon, lat, signal) {
    if (!config.addressUrl) throw new WeatherUpstreamError('unconfigured', '地址增强未配置')
    let url
    try { url = new URL(config.addressUrl) } catch { throw new WeatherUpstreamError('unconfigured', '地址增强未配置') }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new WeatherUpstreamError('unconfigured', '地址增强线路不安全')
    url.searchParams.set('lon', String(lon)); url.searchParams.set('lat', String(lat))
    const { payload, metrics } = await request(url, {}, signal)
    if (payload?.code != null && !['0', 0, '200', 200].includes(payload.code)) throw new WeatherUpstreamError('structure', '地址上游业务失败')
    const addressValue = text(payload?.address)?.trim() ?? null
    if (!addressValue) throw new WeatherUpstreamError('structure', '地址响应结构异常')
    return { data: { address: addressValue, hctype: finite(payload.hctype), jd: text(payload.jd) }, metadata: {}, metrics }
  }
  return { qweather, address }
}
