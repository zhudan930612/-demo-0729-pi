import { WeatherUpstreamError } from './weather-upstream.js'

const DEFAULT_TTLS = { alert: 300_000, current: 600_000, minutely: 300_000, hourly: 1_800_000, address: 2_592_000_000 }

export function createWeatherCache({ now = Date.now, random = Math.random, maxEntries = 2048, maxConcurrency = 6, ttls = {} } = {}) {
  const cache = new Map(), inFlight = new Map(), cooldowns = new Map()
  let activeCount = 0
  const ttl = { ...DEFAULT_TTLS, ...ttls }
  function prune() { while (cache.size > maxEntries) cache.delete(cache.keys().next().value) }
  function cooldownKey(module, key) { return `${module}:${key}` }
  function subscribe(module, key, loader, { allowStale = true } = {}) {
    const stamp = now(), cached = cache.get(key), cooling = cooldowns.get(cooldownKey(module, key))
    if (cached && cached.expiresAt > stamp) return constant(cached.value, 'cache', cached)
    if (cooling && cooling.until > stamp) {
      if (cached && allowStale) return constant({ ...cached.value, stale: true, refreshError: { code: 'UPSTREAM_RATE_LIMITED', message: '更新受限，保留上次成功数据' } }, 'stale', cached)
      throw new WeatherUpstreamError('rate-limit', '天气上游处于共享冷却期', { retryAfterMs: cooling.until - stamp })
    }
    let entry = inFlight.get(key)
    if (!entry) {
      if (activeCount >= maxConcurrency) throw new WeatherUpstreamError('busy', '天气上游并发已达上限')
      const controller = new AbortController()
      entry = { controller, consumers: 0, settled: false }
      activeCount += 1
      entry.promise = Promise.resolve().then(() => loader(controller.signal)).then((value) => {
        const stored = { ...value, fetchedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + ttl[module]).toISOString() }
        cache.delete(key); cache.set(key, { value: stored, expiresAt: now() + ttl[module] }); prune(); cooldowns.delete(cooldownKey(module, key)); return stored
      }).catch((error) => {
        if (error instanceof WeatherUpstreamError && error.kind === 'rate-limit') {
          const previous = cooldowns.get(cooldownKey(module, key)); const count = Math.min(10, (previous?.count ?? 0) + 1)
          const delay = error.retryAfterMs ?? Math.min(300_000, (2 ** count + random()) * 1000)
          cooldowns.set(cooldownKey(module, key), { count, until: now() + delay })
        }
        if (cached && allowStale) return { ...cached.value, stale: true, refreshError: publicModuleError(error) }
        throw error
      }).finally(() => { entry.settled = true; activeCount -= 1; inFlight.delete(key) })
      entry.promise.catch(() => {}); inFlight.set(key, entry)
    }
    entry.consumers += 1; let released = false
    return { promise: entry.promise, source: entry.consumers > 1 ? 'inflight' : 'upstream', release() { if (released) return; released = true; entry.consumers--; if (entry.consumers <= 0 && !entry.settled) entry.controller.abort() } }
  }
  function constant(value, source, cached) { return { promise: Promise.resolve(value), source, cached, release() {} } }
  return {
    subscribe,
    clear() { cache.clear(); cooldowns.clear(); for (const entry of inFlight.values()) entry.controller.abort() },
    stats() { return { cacheSize: cache.size, inFlightSize: inFlight.size, cooldownSize: cooldowns.size, activeCount } },
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
