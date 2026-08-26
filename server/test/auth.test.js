import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createAppServer } from '../src/app.js'

const servers = []

function baseConfig(overrides = {}) {
  return {
    developerId: 'secret-developer-id',
    key: 'secret-key',
    auth: { username: 'admin', password: 'admin123', tokenTtlMs: 60_000 },
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
  return { info(entry) { entries.push(entry) }, error(entry) { entries.push(entry) } }
}

async function startApp(config, options = {}) {
  const logs = []
  const server = createAppServer(config, { logger: quietLogger(logs), ...options })
  return { base: await listen(server), logs }
}

async function body(response) { return JSON.parse(await response.text()) }

function login(base, username, password) {
  return fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

test('正确凭据返回会话令牌，令牌可验证会话', async () => {
  const { base } = await startApp(baseConfig())
  const response = await login(base, 'admin', 'admin123')
  assert.equal(response.status, 200)
  const session = await body(response)
  assert.equal(session.username, 'admin')
  assert.equal(typeof session.token, 'string')
  assert.ok(session.token.length >= 24)
  assert.ok(session.expiresAt > Date.now())

  const check = await fetch(`${base}/api/auth/session`, { headers: { authorization: `Bearer ${session.token}` } })
  assert.equal(check.status, 200)
  assert.equal((await body(check)).username, 'admin')
})

test('错误凭据或缺失字段返回 401/400，不泄露是否命中账号', async () => {
  const { base, logs } = await startApp(baseConfig())
  const wrong = await login(base, 'admin', 'wrong')
  assert.equal(wrong.status, 401)
  assert.equal((await body(wrong)).error.code, 'INVALID_CREDENTIALS')

  const missing = await login(base, 'admin', '')
  assert.equal(missing.status, 400)
  assert.equal((await body(missing)).error.code, 'INVALID_CREDENTIALS')

  assert.equal(JSON.stringify(logs).includes('admin123'), false)
})

test('会话接口对缺失或伪造令牌返回 401', async () => {
  const { base } = await startApp(baseConfig())
  const noHeader = await fetch(`${base}/api/auth/session`)
  assert.equal(noHeader.status, 401)
  assert.equal((await body(noHeader)).error.code, 'UNAUTHORIZED')

  const forged = await fetch(`${base}/api/auth/session`, { headers: { authorization: 'Bearer forged-token' } })
  assert.equal(forged.status, 401)
})

test('退出后令牌失效', async () => {
  const { base } = await startApp(baseConfig())
  const session = await body(await login(base, 'admin', 'admin123'))

  const logout = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` } })
  assert.equal(logout.status, 204)

  const check = await fetch(`${base}/api/auth/session`, { headers: { authorization: `Bearer ${session.token}` } })
  assert.equal(check.status, 401)
})

test('登录接口拒绝查询参数、超大或非法 JSON 请求体', async () => {
  const { base } = await startApp(baseConfig())
  const withQuery = await fetch(`${base}/api/auth/login?x=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(withQuery.status, 400)
  assert.equal((await body(withQuery)).error.code, 'INVALID_AUTH_REQUEST')

  const badJson = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not-json' })
  assert.equal(badJson.status, 400)
  assert.equal((await body(badJson)).error.code, 'INVALID_AUTH_REQUEST')

  const oversized = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'a'.repeat(5000), password: 'b' }) })
  assert.equal(oversized.status, 400)
  assert.equal((await body(oversized)).error.code, 'INVALID_AUTH_REQUEST')
})

test('登录接口不接受 GET', async () => {
  const { base } = await startApp(baseConfig())
  const response = await fetch(`${base}/api/auth/login`)
  assert.equal(response.status, 405)
  assert.equal((await body(response)).error.code, 'METHOD_NOT_ALLOWED')
})
