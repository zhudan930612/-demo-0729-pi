import { gunzipSync, inflateSync, brotliDecompressSync } from 'node:zlib'

export class WeatherUpstreamError extends Error {
  constructor(kind, message, options = {}) { super(message); this.name = 'WeatherUpstreamError'; this.kind = kind; this.status = options.status; this.retryAfterMs = options.retryAfterMs }
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null }
function text(value) { return typeof value === 'string' ? value : null }
function unitValue(value) { if (!object(value)) return null; return { value: finite(value.value), unit: text(value.unit) } }
function condition(value) { if (!object(value)) return null; return { code: text(value.code), text: text(value.text) } }
function attribution(value) { return object(value) ? { name: text(value.name), url: text(value.url) } : null }
function metadata(value) { return object(value) ? { tag: text(value.tag), zeroResult: value.zeroResult === true, attributions: Array.isArray(value.attributions) ? value.attributions.map(attribution).filter(Boolean) : [] } : { tag: null, zeroResult: false, attributions: [] } }
function iso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null }

export function normalizeQWeather(module, payload) {
  if (!object(payload)) throw new WeatherUpstreamError('structure', '天气响应结构异常')
  const meta = metadata(payload.metadata)
  if (module === 'current') {
    if (!object(payload.current)) throw new WeatherUpstreamError('structure', '实时天气响应结构异常')
    const current = payload.current
    return { data: {
      observationTime: iso(current.observationTime), condition: condition(current.condition), temperature: unitValue(current.temperature), feelsLike: unitValue(current.feelsLike),
      precipitation: object(current.precipitation) ? { amount: unitValue(current.precipitation.amount), intensity: unitValue(current.precipitation.intensity), type: text(current.precipitation.type) } : null,
      humidity: finite(current.humidity),
    }, metadata: meta }
  }
  if (module === 'hourly') {
    if (!Array.isArray(payload.hourly) || payload.hourly.length === 0) throw new WeatherUpstreamError('structure', '逐小时天气响应结构异常')
    return { data: payload.hourly.map((item) => {
      if (!object(item) || !iso(item.forecastTime)) throw new WeatherUpstreamError('structure', '逐小时天气项异常')
      return { forecastTime: item.forecastTime, condition: condition(item.condition), temperature: unitValue(item.temperature), precipitation: object(item.precipitation) ? { probability: finite(item.precipitation.probability), amount: unitValue(item.precipitation.amount) } : null }
    }).sort((a, b) => Date.parse(a.forecastTime) - Date.parse(b.forecastTime)), metadata: meta }
  }
  if (module === 'alert') {
    if (!Array.isArray(payload.alerts)) throw new WeatherUpstreamError('structure', '天气预警响应结构异常')
    const alerts = payload.alerts.map((item) => {
      if (!object(item) || typeof item.id !== 'string') throw new WeatherUpstreamError('structure', '天气预警项异常')
      const type = object(item.messageType) ? { code: text(item.messageType.code), supersedes: Array.isArray(item.messageType.supersedes) ? item.messageType.supersedes.filter((v) => typeof v === 'string') : [] } : { code: null, supersedes: [] }
      return { id: item.id, headline: text(item.headline), issuedTime: iso(item.issuedTime), urgency: text(item.urgency), severity: text(item.severity), certainty: text(item.certainty), description: text(item.description), criteria: text(item.criteria), instruction: text(item.instruction), senderName: text(item.senderName), messageType: type, eventType: object(item.eventType) ? { name: text(item.eventType.name), code: text(item.eventType.code) } : null, icon: text(item.icon), color: object(item.color) ? { code: text(item.color.code), red: finite(item.color.red), green: finite(item.color.green), blue: finite(item.color.blue), alpha: finite(item.color.alpha) } : null, effectiveTime: iso(item.effectiveTime), onsetTime: iso(item.onsetTime), expireTime: iso(item.expireTime) }
    })
    const superseded = new Set(alerts.flatMap((item) => item.messageType.supersedes))
    const active = alerts.filter((item) => !superseded.has(item.id) && !['Cancel', 'cancel', 'CANCEL'].includes(item.messageType.code))
    return { data: active, metadata: meta }
  }
  throw new WeatherUpstreamError('structure', '未知天气模块')
}

export function normalizeMinutely(payload) {
  if (!object(payload)) throw new WeatherUpstreamError('structure', '分钟降水响应结构异常')
  const refer = object(payload.refer) ? { sources: Array.isArray(payload.refer.sources) ? payload.refer.sources.filter((v) => typeof v === 'string') : [], license: Array.isArray(payload.refer.license) ? payload.refer.license.filter((v) => typeof v === 'string') : [] } : { sources: [], license: [] }
  if (!Array.isArray(payload.minutely)) {
    if (payload.code === '204') return { data: null, metadata: { ...metadata(null), refer }, empty: true }
    throw new WeatherUpstreamError('structure', '分钟降水响应结构异常')
  }
  return { data: { updateTime: iso(payload.updateTime), summary: text(payload.summary), minutely: payload.minutely.map((item) => {
    if (!object(item) || !iso(item.fxTime) || !Number.isFinite(Number(item.precip))) throw new WeatherUpstreamError('structure', '分钟降水项异常')
    return { fxTime: item.fxTime, precip: Number(item.precip), type: text(item.type) }
  }), refer }, metadata: { ...metadata(null), refer }, empty: payload.minutely.length === 0 }
}

function retryAfter(value, now) {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now()) : null
}
async function bodyBytes(response, networkMax, decodedMax) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > networkMax) throw new WeatherUpstreamError('too-large', '天气响应超过网络大小限制')
  const compressed = new Uint8Array(await response.arrayBuffer())
  if (compressed.byteLength > networkMax) throw new WeatherUpstreamError('too-large', '天气响应超过网络大小限制')
  let decoded = compressed
  const encoding = response.headers.get('content-encoding')?.toLowerCase()
  try {
    // fetch normally auto-decompresses and removes/retains inconsistent headers depending on implementation.
    if (encoding === 'gzip' && compressed[0] === 0x1f && compressed[1] === 0x8b) decoded = gunzipSync(compressed)
    else if (encoding === 'deflate') decoded = inflateSync(compressed)
    else if (encoding === 'br') decoded = brotliDecompressSync(compressed)
    else if (encoding && !['identity', 'gzip'].includes(encoding)) throw new Error('unsupported')
  } catch { throw new WeatherUpstreamError('decompression', '天气响应解压失败') }
  if (decoded.byteLength > decodedMax) throw new WeatherUpstreamError('too-large', '天气响应解压后超过大小限制')
  try { return JSON.parse(new TextDecoder().decode(decoded)) } catch { throw new WeatherUpstreamError('json', '天气响应不是有效 JSON') }
}

export function createWeatherUpstream(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? Date.now
  async function request(url, headers, signal) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort()
    const timer = setTimeout(abort, config.timeoutMs)
    try {
      const response = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json', 'accept-encoding': 'gzip', ...headers }, signal: controller.signal })
      if (!response.ok) {
        const status = response.status
        const kind = status === 429 ? 'rate-limit' : [400, 401, 403].includes(status) ? 'authentication' : 'http'
        throw new WeatherUpstreamError(kind, '天气上游请求失败', { status, retryAfterMs: retryAfter(response.headers.get('retry-after'), now) })
      }
      return await bodyBytes(response, config.maxNetworkBytes, config.maxDecodedBytes)
    } catch (error) {
      if (error instanceof WeatherUpstreamError) throw error
      if (controller.signal.aborted || error?.name === 'AbortError') throw new WeatherUpstreamError('timeout', '天气上游响应超时')
      throw new WeatherUpstreamError('network', '天气上游网络错误')
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  function qweather(module, lat, lon, signal) {
    if (config.authMode !== 'api-key' || !config.apiOrigin || !config.apiKey || !config.projectId || !config.credentialId) throw new WeatherUpstreamError('unconfigured', '和风天气未配置')
    let url
    if (module === 'minutely') {
      url = new URL('/v7/minutely/5m', config.apiOrigin); url.searchParams.set('location', `${lon},${lat}`); url.searchParams.set('lang', 'zh')
    } else {
      const route = module === 'alert' ? 'weatheralert/v1/current' : module === 'current' ? 'weather/v1/current' : 'weather/v1/hourly'
      url = new URL(`/${route}/${lat}/${lon}`, config.apiOrigin); url.searchParams.set('lang', 'zh'); url.searchParams.set('localTime', 'true'); if (module === 'hourly') url.searchParams.set('hours', '24')
    }
    return request(url, { 'X-QW-Api-Key': config.apiKey }, signal).then((payload) => module === 'minutely' ? normalizeMinutely(payload) : normalizeQWeather(module, payload))
  }
  async function address(lon, lat, signal) {
    if (!config.addressUrl) throw new WeatherUpstreamError('unconfigured', '地址增强未配置')
    let url
    try { url = new URL(config.addressUrl) } catch { throw new WeatherUpstreamError('unconfigured', '地址增强未配置') }
    url.searchParams.set('lon', String(lon)); url.searchParams.set('lat', String(lat))
    const payload = await request(url, {}, signal)
    const addressValue = typeof payload.address === 'string' && payload.address.trim() ? payload.address.trim() : null
    if (!addressValue) throw new WeatherUpstreamError('structure', '地址响应结构异常')
    return { data: { address: addressValue, hctype: finite(payload.hctype), jd: text(payload.jd) }, metadata: {} }
  }
  return { qweather, address }
}
