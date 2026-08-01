export class ResourceLimitError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'ResourceLimitError'
    this.kind = kind
  }
}

function deleteOldest(map) {
  const oldest = map.keys().next().value
  if (oldest !== undefined) map.delete(oldest)
}

/** 固定窗口基础限流；只使用 socket IP，避免信任未配置网关的转发头。 */
export function createIpRateLimiter({ limit, windowMs, maxClients = 2048, now = Date.now }) {
  const clients = new Map()

  function cleanupExpired(timestamp) {
    // 每次访问全量回收过期窗口，避免不再访问的 IP 永久占用内存。
    for (const [ip, entry] of clients) if (timestamp >= entry.resetAt) clients.delete(ip)
  }

  return {
    consume(ip) {
      const timestamp = now()
      cleanupExpired(timestamp)
      const current = clients.get(ip)
      if (!current) {
        // 容量达到上限时按插入顺序淘汰最旧窗口；容量始终为硬上限。
        while (clients.size >= maxClients) deleteOldest(clients)
        clients.set(ip, { count: 1, resetAt: timestamp + windowMs })
        return true
      }
      if (current.count >= limit) return false
      current.count += 1
      return true
    },
    clear() { clients.clear() },
    stats() { return { clientCount: clients.size } },
  }
}

/**
 * 全局唯一上游请求 broker：相同业务 key 合并、成功结果短缓存、唯一请求并发受限。
 * cache/in-flight key 仅由 list 年份或 detail 编号构成，不包含凭据。
 */
export function createUpstreamBroker({ maxConcurrency, cacheTtlMs, cacheMaxEntries = 128, now = Date.now }) {
  const cache = new Map()
  const inFlight = new Map()
  let activeCount = 0

  function cleanupExpired(timestamp) {
    // 每次访问全量回收过期缓存，原 key 不再访问也不会滞留。
    for (const [key, entry] of cache) if (entry.expiresAt <= timestamp) cache.delete(key)
  }

  function cacheSuccess(key, value) {
    const timestamp = now()
    cleanupExpired(timestamp)
    cache.delete(key)
    // Map 插入顺序作为 LRU 顺序；满载时淘汰最久未使用的成功项。
    while (cache.size >= cacheMaxEntries) deleteOldest(cache)
    cache.set(key, { value, expiresAt: timestamp + cacheTtlMs })
  }

  function subscribe(key, loader) {
    const timestamp = now()
    cleanupExpired(timestamp)
    const cached = cache.get(key)
    if (cached) {
      // 命中后移动到末尾，形成明确 LRU 淘汰顺序。
      cache.delete(key)
      cache.set(key, cached)
      return { promise: Promise.resolve(cached.value), release() {}, source: 'cache' }
    }

    let entry = inFlight.get(key)
    if (!entry) {
      if (activeCount >= maxConcurrency) throw new ResourceLimitError('concurrency', '上游并发已达上限')
      const controller = new AbortController()
      activeCount += 1
      entry = { controller, consumers: 0, settled: false, promise: null }
      entry.promise = Promise.resolve()
        .then(() => loader(controller.signal))
        .then((value) => {
          cacheSuccess(key, value)
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
