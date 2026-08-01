import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createIpRateLimiter, createUpstreamBroker, ResourceLimitError } from '../src/resource-manager.js'

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('IP limiter enforces a fixed window and resets', () => {
  let now = 0
  const limiter = createIpRateLimiter({ limit: 2, windowMs: 100, maxClients: 8, now: () => now })
  assert.equal(limiter.consume('a'), true)
  assert.equal(limiter.consume('a'), true)
  assert.equal(limiter.consume('a'), false)
  assert.equal(limiter.consume('b'), true)
  now = 100
  assert.equal(limiter.consume('a'), true)
})

test('IP limiter cleans expired clients on another IP and keeps a hard capacity', () => {
  let now = 0
  const limiter = createIpRateLimiter({ limit: 1, windowMs: 100, maxClients: 2, now: () => now })
  limiter.consume('a'); limiter.consume('b')
  assert.equal(limiter.stats().clientCount, 2)
  limiter.consume('c')
  assert.equal(limiter.stats().clientCount, 2)
  // a 是最旧项，容量淘汰后可重新进入；Map 仍不超过硬上限。
  assert.equal(limiter.consume('a'), true)
  assert.equal(limiter.stats().clientCount, 2)
  now = 100
  limiter.consume('different')
  assert.equal(limiter.stats().clientCount, 1)
})

test('broker merges in-flight requests and cache key contains no credentials', async () => {
  let calls = 0
  const work = deferred()
  const broker = createUpstreamBroker({ maxConcurrency: 2, cacheTtlMs: 1000 })
  const loader = () => { calls += 1; return work.promise }
  const one = broker.subscribe('list:2026', loader)
  const two = broker.subscribe('list:2026', loader)
  assert.equal(calls, 0)
  await Promise.resolve()
  assert.equal(calls, 1)
  work.resolve({ code: 200, list: [] })
  assert.deepEqual(await one.promise, await two.promise)
  one.release(); two.release()
  const cached = broker.subscribe('list:2026', () => { throw new Error('must not call') })
  assert.equal(cached.source, 'cache')
  assert.equal(broker.stats().cacheSize, 1)
})

test('broker TTL expires and failures are not cached', async () => {
  let now = 0, calls = 0
  const broker = createUpstreamBroker({ maxConcurrency: 2, cacheTtlMs: 10, cacheMaxEntries: 4, now: () => now })
  const first = broker.subscribe('detail:1', async () => ({ call: ++calls }))
  assert.deepEqual(await first.promise, { call: 1 }); first.release()
  now = 11
  const second = broker.subscribe('detail:1', async () => ({ call: ++calls }))
  assert.deepEqual(await second.promise, { call: 2 }); second.release()
  const failed = broker.subscribe('detail:2', async () => { calls += 1; throw new Error('fail') })
  await assert.rejects(failed.promise); failed.release()
  const retry = broker.subscribe('detail:2', async () => ({ call: ++calls }))
  assert.deepEqual(await retry.promise, { call: 4 }); retry.release()
})

test('broker cleans expired entries on a different key and evicts least recently used entries', async () => {
  let now = 0, calls = 0
  const broker = createUpstreamBroker({ maxConcurrency: 2, cacheTtlMs: 10, cacheMaxEntries: 2, now: () => now })
  const load = async (key) => ({ key, call: ++calls })
  for (const key of ['a', 'b']) {
    const item = broker.subscribe(key, () => load(key)); await item.promise; item.release()
  }
  assert.equal(broker.stats().cacheSize, 2)
  // 命中 a 后将其提升为最新，随后 c 淘汰最久未使用的 b。
  const hit = broker.subscribe('a', () => load('a')); assert.equal(hit.source, 'cache'); await hit.promise
  const c = broker.subscribe('c', () => load('c')); await c.promise; c.release()
  assert.equal(broker.stats().cacheSize, 2)
  const b = broker.subscribe('b', () => load('b')); assert.equal(b.source, 'upstream'); await b.promise; b.release()
  now = 11
  const different = broker.subscribe('different', () => load('different')); await different.promise; different.release()
  // 访问不同 key 会全量清除 a/c/b 等过期项，只留下刚写入项。
  assert.equal(broker.stats().cacheSize, 1)
})

test('global concurrency rejects a different unique request', async () => {
  const work = deferred()
  const broker = createUpstreamBroker({ maxConcurrency: 1, cacheTtlMs: 10 })
  const active = broker.subscribe('detail:1', () => work.promise)
  await Promise.resolve()
  assert.throws(() => broker.subscribe('detail:2', async () => ({})), (error) => error instanceof ResourceLimitError)
  work.resolve({}); await active.promise; active.release()
})

test('disconnecting one merged consumer does not abort the shared upstream', async () => {
  const work = deferred()
  let signal
  const broker = createUpstreamBroker({ maxConcurrency: 1, cacheTtlMs: 10 })
  const loader = (value) => { signal = value; return work.promise }
  const one = broker.subscribe('detail:1', loader)
  const two = broker.subscribe('detail:1', loader)
  await Promise.resolve()
  one.release()
  assert.equal(signal.aborted, false)
  work.resolve({ ok: true })
  assert.deepEqual(await two.promise, { ok: true })
  two.release()
})

test('last disconnected consumer aborts the exclusive upstream', async () => {
  let aborted = false
  const broker = createUpstreamBroker({ maxConcurrency: 1, cacheTtlMs: 10 })
  const item = broker.subscribe('detail:1', (signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) })))
  await Promise.resolve()
  item.release()
  await assert.rejects(item.promise)
  assert.equal(aborted, true)
})
