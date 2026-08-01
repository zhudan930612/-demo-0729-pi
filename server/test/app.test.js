import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createAppServer } from '../src/app.js'

const secrets = { developerId: 'secret-developer-id', key: 'secret-key' }
const servers = []

function baseConfig(overrides = {}) {
  return {
    ...secrets,
    upstreamUrl: 'https://cn.apihz.cn/api/tianqi/taifeng.php',
    timeoutMs: 100,
    maxResponseBytes: 1024 * 1024,
    ...overrides,
  }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

function quietLogger(entries = []) {
  return {
    info(entry) { entries.push(entry) },
    error(entry) { entries.push(entry) },
  }
}

async function startApp(config, options = {}) {
  const logs = []
  const server = createAppServer(config, { logger: quietLogger(logs), ...options })
  return { base: await listen(server), logs }
}

async function body(response) {
  return JSON.parse(await response.text())
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

test('healthz reports configuration without revealing credentials or enabling CORS', async () => {
  const { base, logs } = await startApp(baseConfig())
  const response = await fetch(`${base}/healthz`)
  const text = await response.text()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), null)
  assert.deepEqual(JSON.parse(text), { ok: true, configured: true })
  const serialized = JSON.stringify({ text, logs })
  assert.equal(serialized.includes(secrets.developerId), false)
  assert.equal(serialized.includes(secrets.key), false)
})

test('missing credentials fails safely with unified response', async () => {
  const { base, logs } = await startApp(baseConfig({ developerId: '', key: '' }))
  const response = await fetch(`${base}/api/typhoons?year=2026`)
  const payload = await body(response)
  assert.equal(response.status, 503)
  assert.equal(payload.error.code, 'SERVICE_UNCONFIGURED')
  assert.match(payload.error.requestId, /^[0-9a-f-]{36}$/)
  assert.equal(JSON.stringify({ payload, logs }).includes('secret'), false)
})

test('rejects invalid, duplicate, future, or extra list parameters without upstream requests', async () => {
  let calls = 0
  const { base } = await startApp(baseConfig(), {
    now: () => Date.UTC(2026, 7, 1, 16),
    fetchImpl: async () => { calls += 1; return Response.json({ code: 200, list: [] }) },
  })
  for (const path of [
    '/api/typhoons',
    '/api/typhoons?year=2026&year=2025',
    '/api/typhoons?year=2026.0',
    '/api/typhoons?year=2027',
    '/api/typhoons?year=2026&no=1',
  ]) {
    const response = await fetch(base + path)
    assert.equal(response.status, 400, path)
  }
  assert.equal(calls, 0)
})

test('rejects unsafe detail identifiers and query parameters', async () => {
  let calls = 0
  const { base } = await startApp(baseConfig(), {
    fetchImpl: async () => { calls += 1; return Response.json({ code: 200, no1: '1', datas: [] }) },
  })
  for (const path of ['/api/typhoons/a1', '/api/typhoons/1%2F2', '/api/typhoons/1?extra=yes']) {
    const response = await fetch(base + path)
    assert.ok([400, 404].includes(response.status), path)
  }
  assert.equal(calls, 0)
})

test('passes through valid list and detail payloads while injecting credentials only upstream', async () => {
  const upstreamUrls = []
  const fetchImpl = async (url) => {
    upstreamUrls.push(url)
    if (url.searchParams.has('year')) {
      return Response.json({ code: 200, list: [{ no1: '100', type: 'start', namecn: '示例' }] })
    }
    return Response.json({ code: 200, no1: '100', type: 'start', datas: [] })
  }
  const { base, logs } = await startApp(baseConfig(), { fetchImpl })
  const list = await fetch(`${base}/api/typhoons?year=2026`)
  const detail = await fetch(`${base}/api/typhoons/100`)
  assert.equal(list.status, 200)
  assert.equal(detail.status, 200)
  assert.deepEqual((await body(list)).list[0].no1, '100')
  assert.equal((await body(detail)).no1, '100')
  assert.equal(upstreamUrls.length, 2)
  assert.equal(upstreamUrls[0].origin + upstreamUrls[0].pathname, 'https://cn.apihz.cn/api/tianqi/taifeng.php')
  assert.equal(upstreamUrls[0].searchParams.get('id'), secrets.developerId)
  assert.equal(upstreamUrls[0].searchParams.get('key'), secrets.key)
  assert.equal(JSON.stringify(logs).includes(secrets.developerId), false)
  assert.equal(JSON.stringify(logs).includes(secrets.key), false)
})

for (const scenario of [
  {
    name: 'upstream non-2xx',
    fetchImpl: async () => new Response('failure', { status: 503 }),
  },
  {
    name: 'upstream non-JSON',
    fetchImpl: async () => new Response('<html>failure</html>', { status: 200 }),
  },
  {
    name: 'upstream business error',
    fetchImpl: async () => Response.json({ code: 400, msg: 'sensitive upstream details' }),
  },
  {
    name: 'upstream malformed list',
    fetchImpl: async () => Response.json({ code: 200, list: [{ no1: '1', type: 'unknown' }] }),
  },
]) {
  test(`${scenario.name} maps to non-leaking unified error`, async () => {
    const { base, logs } = await startApp(baseConfig(), { fetchImpl: scenario.fetchImpl })
    const response = await fetch(`${base}/api/typhoons?year=2026`)
    const payload = await body(response)
    assert.equal(response.status, 502)
    assert.equal(payload.error.code, 'UPSTREAM_ERROR')
    const serialized = JSON.stringify({ payload, logs })
    assert.equal(serialized.includes('sensitive upstream details'), false)
    assert.equal(serialized.includes(secrets.developerId), false)
    assert.equal(serialized.includes(secrets.key), false)
  })
}

test('malformed detail maps to unified error', async () => {
  const { base } = await startApp(baseConfig(), {
    fetchImpl: async () => Response.json({ code: 200, no1: '1', datas: null }),
  })
  const response = await fetch(`${base}/api/typhoons/1`)
  assert.equal(response.status, 502)
  assert.equal((await body(response)).error.code, 'UPSTREAM_ERROR')
})

test('upstream timeout returns 504 without leaking secrets', async () => {
  const fetchImpl = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
  })
  const { base, logs } = await startApp(baseConfig({ timeoutMs: 10 }), { fetchImpl })
  const response = await fetch(`${base}/api/typhoons?year=2026`)
  const payload = await body(response)
  assert.equal(response.status, 504)
  assert.equal(payload.error.code, 'UPSTREAM_TIMEOUT')
  assert.equal(JSON.stringify({ payload, logs }).includes(secrets.key), false)
})

test('timeout also interrupts a stalled response body', async () => {
  const fetchImpl = async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      options.signal.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    },
  }), { status: 200 })
  const { base } = await startApp(baseConfig({ timeoutMs: 10 }), { fetchImpl })
  const response = await fetch(`${base}/api/typhoons?year=2026`)
  assert.equal(response.status, 504)
  assert.equal((await body(response)).error.code, 'UPSTREAM_TIMEOUT')
})

test('oversized upstream response is rejected', async () => {
  const { base } = await startApp(baseConfig({ maxResponseBytes: 32 }), {
    fetchImpl: async () => new Response(JSON.stringify({ code: 200, list: [], padding: 'x'.repeat(100) })),
  })
  const response = await fetch(`${base}/api/typhoons?year=2026`)
  assert.equal(response.status, 502)
  assert.equal((await body(response)).error.code, 'UPSTREAM_RESPONSE_TOO_LARGE')
})
