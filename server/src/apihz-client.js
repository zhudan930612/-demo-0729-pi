export class UpstreamError extends Error {
  constructor(kind, message) {
    super(message)
    this.name = 'UpstreamError'
    this.kind = kind
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validIdentifier(value) {
  return (typeof value === 'string' && value.length > 0) || Number.isFinite(value)
}

export function validateApiHzPayload(payload, mode) {
  if (!isObject(payload)) throw new UpstreamError('structure', '上游响应结构无效')
  if (payload.code !== 200) throw new UpstreamError('business', '上游业务请求失败')
  if (mode === 'list') {
    if (!Array.isArray(payload.list) || payload.list.some((item) => !isObject(item)
      || !validIdentifier(item.no1) || !['start', 'stop'].includes(item.type))) {
      throw new UpstreamError('structure', '上游台风列表结构无效')
    }
  } else if (!validIdentifier(payload.no1) || !Array.isArray(payload.datas)) {
    throw new UpstreamError('structure', '上游台风详情结构无效')
  }
  return payload
}

async function readResponseText(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new UpstreamError('too-large', '上游响应超过大小限制')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new UpstreamError('too-large', '上游响应超过大小限制')
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

export function createApiHzClient(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')

  async function request(params, mode) {
    if (!config.developerId || !config.key) throw new UpstreamError('unconfigured', 'APIHz 服务未配置')
    const url = new URL(config.upstreamUrl)
    url.searchParams.set('id', config.developerId)
    url.searchParams.set('key', config.key)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new UpstreamError('http', '上游 HTTP 请求失败')
      const text = await readResponseText(response, config.maxResponseBytes)
      let payload
      try {
        payload = JSON.parse(text)
      } catch {
        throw new UpstreamError('json', '上游返回非 JSON 数据')
      }
      return validateApiHzPayload(payload, mode)
    } catch (error) {
      if (error instanceof UpstreamError) throw error
      if (controller.signal.aborted || error?.name === 'AbortError') {
        throw new UpstreamError('timeout', '上游请求超时')
      }
      throw new UpstreamError('network', '上游网络请求失败')
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    list(year) { return request({ year: String(year) }, 'list') },
    detail(no) { return request({ no: String(no) }, 'detail') },
  }
}
