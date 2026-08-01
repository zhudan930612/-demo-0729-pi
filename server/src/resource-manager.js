export class ResourceLimitError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'ResourceLimitError'
    this.kind = kind
  }
}

/** 固定窗口基础限流；只使用 socket IP，避免信任未配置网关的转发头。 */
export function createIpRateLimiter({ limit, windowMs, now = Date.now }) {
  const clients = new Map()
  return {
    consume(ip) {
      const timestamp = now()
      const current = clients.get(ip)
      if (!current || timestamp >= current.resetAt) {
        clients.set(ip, { count: 1, resetAt: timestamp + windowMs })
        return true
      }
      if (current.count >= limit) return false
      current.count += 1
      return true
    },
    clear() { clients.clear() },
  }
}

/**
 * 全局唯一上游请求 broker：相同业务 key 合并、成功结果短缓存、唯一请求并发受限。
 * cache/in-flight key 仅由 list 年份或 detail 编号构成，不包含凭据。
 */
export function createUpstreamBroker({ maxConcurrency, cacheTtlMs, now = Date.now }) {
  const cache = new Map()
  const inFlight = new Map()
  let activeCount = 0

  function subscribe(key, loader) {
    const cached = cache.get(key)
    const timestamp = now()
    if (cached && cached.expiresAt > timestamp) {
      return { promise: Promise.resolve(cached.value), release() {}, source: 'cache' }
    }
    if (cached) cache.delete(key)

    let entry = inFlight.get(key)
    if (!entry) {
      if (activeCount >= maxConcurrency) throw new ResourceLimitError('concurrency', '上游并发已达上限')
      const controller = new AbortController()
      activeCount += 1
      entry = { controller, consumers: 0, settled: false, promise: null }
      entry.promise = Promise.resolve()
        .then(() => loader(controller.signal))
        .then((value) => {
          cache.set(key, { value, expiresAt: now() + cacheTtlMs })
          return value
        })
        .finally(() => {
          entry.settled = true
          activeCount -= 1
          inFlight.delete(key)
        })
      // 消费者断开后 promise 仍可能拒绝；broker 必须自行持有拒绝处理，避免 unhandled rejection。
      entry.promise.catch(() => {})
      inFlight.set(key, entry)
    }
    entry.consumers += 1
    let released = false
    return {
      promise: entry.promise,
      source: entry.consumers > 1 ? 'inflight' : 'upstream',
      release() {
        if (released) return
        released = true
        entry.consumers = Math.max(0, entry.consumers - 1)
        // 只有最后一个消费者断开才取消共享请求；不会影响仍等待的其他客户端。
        if (entry.consumers === 0 && !entry.settled) entry.controller.abort()
      },
    }
  }

  return {
    subscribe,
    clear() {
      cache.clear()
      for (const entry of inFlight.values()) entry.controller.abort()
      inFlight.clear()
    },
    stats() { return { activeCount, cacheSize: cache.size, inFlightSize: inFlight.size } },
  }
}
