import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { createApiHzClient, UpstreamError } from './apihz-client.js'

function beijingYear(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).getUTCFullYear()
}

function sendJson(response, status, payload, requestId) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-request-id': requestId,
  })
  response.end(body)
}

function publicError(error) {
  if (!(error instanceof UpstreamError)) return { status: 500, code: 'INTERNAL_ERROR', message: '服务内部错误' }
  switch (error.kind) {
    case 'unconfigured': return { status: 503, code: 'SERVICE_UNCONFIGURED', message: '台风数据服务尚未配置' }
    case 'timeout': return { status: 504, code: 'UPSTREAM_TIMEOUT', message: '台风数据服务响应超时' }
    case 'too-large': return { status: 502, code: 'UPSTREAM_RESPONSE_TOO_LARGE', message: '台风数据服务响应异常' }
    default: return { status: 502, code: 'UPSTREAM_ERROR', message: '台风数据服务暂时不可用' }
  }
}

function safeLog(logger, level, entry) {
  const method = logger?.[level]
  if (typeof method === 'function') method.call(logger, entry)
}

export function createAppServer(config, options = {}) {
  const client = createApiHzClient(config, options)
  const logger = options.logger ?? console
  const now = options.now ?? Date.now
  return http.createServer(async (request, response) => {
    const requestId = randomUUID()
    const startedAt = Date.now()
    let status = 500
    let routeName = 'not-found'
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method !== 'GET') {
        status = 405
        sendJson(response, status, { error: { code: 'METHOD_NOT_ALLOWED', message: '仅支持 GET 请求', requestId } }, requestId)
        return
      }
      if (url.pathname === '/healthz') {
        routeName = 'healthz'
        status = 200
        sendJson(response, status, { ok: true, configured: Boolean(config.developerId && config.key) }, requestId)
        return
      }
      if (url.pathname === '/api/typhoons') {
        routeName = 'typhoon-list'
        const years = url.searchParams.getAll('year')
        if (years.length !== 1 || [...url.searchParams.keys()].some((key) => key !== 'year') || !/^\d{4}$/.test(years[0])) {
          status = 400
          sendJson(response, status, { error: { code: 'INVALID_YEAR', message: 'year 必须是唯一的四位年份参数', requestId } }, requestId)
          return
        }
        const year = Number(years[0])
        if (year < 2000 || year > beijingYear(now())) {
          status = 400
          sendJson(response, status, { error: { code: 'INVALID_YEAR', message: 'year 超出可查询范围', requestId } }, requestId)
          return
        }
        const payload = await client.list(year)
        status = 200
        sendJson(response, status, payload, requestId)
        return
      }
      const match = url.pathname.match(/^\/api\/typhoons\/([^/]+)$/)
      if (match) {
        routeName = 'typhoon-detail'
        if (url.search || !/^\d{1,32}$/.test(match[1])) {
          status = 400
          sendJson(response, status, { error: { code: 'INVALID_TYPHOON_NO', message: '台风编号格式无效', requestId } }, requestId)
          return
        }
        const payload = await client.detail(match[1])
        status = 200
        sendJson(response, status, payload, requestId)
        return
      }
      status = 404
      sendJson(response, status, { error: { code: 'NOT_FOUND', message: '接口不存在', requestId } }, requestId)
    } catch (error) {
      const mapped = publicError(error)
      status = mapped.status
      sendJson(response, status, { error: { code: mapped.code, message: mapped.message, requestId } }, requestId)
    } finally {
      safeLog(logger, status >= 500 ? 'error' : 'info', {
        requestId,
        method: request.method,
        route: routeName,
        status,
        durationMs: Date.now() - startedAt,
      })
    }
  })
}
