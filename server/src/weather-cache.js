import { WeatherUpstreamError } from './weather-upstream.js'

const DEFAULT_TTLS = { alert: 300_000, current: 600_000, minutely: 300_000, hourly: 1_800_000, address: 2_592_000_000 }
const RECOVERABLE = new Set(['rate-limit', 'http', 'network', 'timeout'])

export function createWeatherCache({ now = Date.now, random = Math.random, maxEntries = 2048, maxConcurrency = 6, maxCooldowns = maxEntries, ttls = {} } = {}) {
  const cache = new Map(), inFlight = new Map(), cooldowns = new Map(), retryCounts = new Map(), breakers = new Map(), queue = []
  let activeCount = 0
  const ttl = { ...DEFAULT_TTLS, ...ttls }
  function pruneMap(map, limit) { while (map.size > limit) map.delete(map.keys().next().value) }
  function pruneExpiredCooldowns(stamp = now()) { for (const [key, value] of cooldowns) if (value.until <= stamp) cooldowns.delete(key) }
  function cooldownKey(module, key) { return `${module}:${key}` }
  function constant(value, source) { return { promise: Promise.resolve(value), source, release() {} } }
  function pump() {
    while (activeCount < maxConcurrency && queue.length) {
      const entry = queue.shift()
      if (entry.settled) { entry.finishAbort(); continue }
      entry.queued = false; entry.started = true; activeCount++
      Promise.resolve().then(() => entry.loader(entry.controller.signal)).then(entry.resolve, entry.reject).finally(() => { activeCount--; pump() })
    }
  }
  function subscribe(module, key, loader, { allowStale = true } = {}) {
    const stamp = now(); pruneExpiredCooldowns(stamp)
    const cached = cache.get(key), breaker = breakers.get(module), cooling = cooldowns.get(cooldownKey(module, key))
    if (cached && cached.expiresAt > stamp) return constant(cached.value, 'cache')
    if (breaker) {
      if (cached && allowStale) return constant({ ...cached.value, stale: true, refreshError: publicModuleError(breaker) }, 'stale')
      return rejectedSubscription(breaker)
    }
    if (cooling) {
      if (cached && allowStale) return constant({ ...cached.value, stale: true, refreshError: publicModuleError(cooling.error) }, 'stale')
      return rejectedSubscription(new WeatherUpstreamError(cooling.error.kind, '天气上游处于共享冷却期', { retryAfterMs: cooling.until - stamp }))
    }
    let entry = inFlight.get(key)
    if (!entry) {
      const controller = new AbortController()
      let resolveLoad, rejectLoad
      const loadPromise = new Promise((resolve, reject) => { resolveLoad = resolve; rejectLoad = reject })
      entry = { controller, consumers: 0, settled: false, queued: true, started: false, loader, resolve: resolveLoad, reject: rejectLoad, finishAbort() { rejectLoad(new WeatherUpstreamError('aborted', '天气请求已取消')) } }
      entry.promise = loadPromise.then((value) => {
        const fetchedStamp = now()
        const stored = { ...value, fetchedAt: new Date(fetchedStamp).toISOString(), expiresAt: new Date(fetchedStamp + ttl[module]).toISOString() }
        cache.delete(key); cache.set(key, { value: stored, expiresAt: fetchedStamp + ttl[module] }); pruneMap(cache, maxEntries)
        const id = cooldownKey(module, key); cooldowns.delete(id); retryCounts.delete(id); return stored
      }).catch((error) => {
        if (error instanceof WeatherUpstreamError && error.kind === 'authentication') breakers.set(module, error)
        if (error instanceof WeatherUpstreamError && RECOVERABLE.has(error.kind)) {
          const id = cooldownKey(module, key), count = Math.min(10, (retryCounts.get(id) ?? 0) + 1)
          retryCounts.delete(id); retryCounts.set(id, count); pruneMap(retryCounts, maxCooldowns)
          const exponential = Math.min(300_000, ((2 ** count) + random()) * 1000)
          const delay = error.kind === 'rate-limit' && error.retryAfterMs != null ? error.retryAfterMs : exponential
          cooldowns.delete(id); cooldowns.set(id, { count, until: now() + delay, error }); pruneMap(cooldowns, maxCooldowns)
        }
        if (cached && allowStale) return { ...cached.value, stale: true, refreshError: publicModuleError(error) }
        throw error
      }).finally(() => { entry.settled = true; inFlight.delete(key) })
      entry.promise.catch(() => {}); inFlight.set(key, entry); queue.push(entry); pump()
    }
    entry.consumers += 1; let released = false
    return { promise: entry.promise, source: entry.started ? 'upstream' : entry.consumers > 1 ? 'inflight' : 'queued', release() { if (released) return; released = true; entry.consumers--; if (entry.consumers <= 0 && !entry.settled) { entry.controller.abort(); if (entry.queued) { entry.settled = true; const index = queue.indexOf(entry); if (index >= 0) queue.splice(index, 1); entry.finishAbort(); inFlight.delete(key) } } } }
  }
  function rejectedSubscription(error) { return { promise: Promise.reject(error), source: 'blocked', release() {} } }
  return {
    subscribe,
    clear() { cache.clear(); cooldowns.clear(); retryCounts.clear(); breakers.clear(); for (const entry of inFlight.values()) entry.controller.abort(); for (const entry of queue.splice(0)) entry.finishAbort() },
    stats() { pruneExpiredCooldowns(); return { cacheSize: cache.size, inFlightSize: inFlight.size, queuedSize: queue.length, cooldownSize: cooldowns.size, breakerSize: breakers.size, activeCount } },
  }
}

export function publicModuleError(error) {
  switch (error?.kind) {
    case 'unconfigured': return { code: 'WEATHER_UPSTREAM_UNCONFIGURED', message: '天气模块尚未配置' }
    case 'timeout': return { code: 'WEATHER_UPSTREAM_TIMEOUT', message: '天气模块响应超时' }
    case 'rate-limit': return { code: 'WEATHER_UPSTREAM_RATE_LIMITED', message: '天气模块请求受限，请稍后重试' }
    case 'authentication': return { code: 'WEATHER_UPSTREAM_AUTH_ERROR', message: '天气模块认证配置无效' }
    case 'too-large': case 'decompression': case 'json': case 'structure': return { code: 'WEATHER_UPSTREAM_INVALID_RESPONSE', message: '天气模块响应异常' }
    case 'busy': return { code: 'WEATHER_SERVICE_BUSY', message: '天气模块服务繁忙，请稍后重试' }
    default: return { code: 'WEATHER_UPSTREAM_ERROR', message: '天气模块暂时不可用' }
  }
}
