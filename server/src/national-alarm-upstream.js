import https from 'node:https'
import { Readable } from 'node:stream'

export const NMC_ORIGIN = 'https://www.nmc.cn'
export const NMC_LIST_PATH = '/rest/findAlarm'
export const LIST_QUERY = Object.freeze({ pageNo: '1', pageSize: '10000' })
const SOURCE_PATH = /^\/publish\/alarm\/[A-Za-z0-9_-]+\.html$/

export class NationalAlarmUpstreamError extends Error {
  constructor(kind, message = '中央气象台预警数据暂不可用') { super(message); this.name = 'NationalAlarmUpstreamError'; this.kind = kind }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function header(headers, name) { const value = typeof headers?.get === 'function' ? headers.get(name) : headers?.[name.toLowerCase()]; return Array.isArray(value) ? value[0] : value == null ? null : String(value) }
function fixedUrl(path, query) { const url = new URL(path, NMC_ORIGIN); for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value); return url }
function responseFromFetch(response) { return { status: response.status, headers: response.headers, stream: response.body ? Readable.fromWeb(response.body) : Readable.from([]), redirected: response.redirected } }
function nativeTransport(url, init) {
  return new Promise((resolve, reject) => {
    // Explicit destruction is required on older Node HTTPS stacks where the signal
    // does not consistently interrupt DNS/connect stalls.
    const request = https.request(url, { method: 'GET', headers: init.headers }, (response) => {
      init.signal?.removeEventListener('abort', abort)
      resolve({ status: response.statusCode ?? 0, headers: response.headers, stream: response, redirected: false })
    })
    const abort = () => request.destroy(Object.assign(new Error('request aborted'), { name: 'AbortError' }))
    init.signal?.addEventListener('abort', abort, { once: true }); if (init.signal?.aborted) abort()
    request.once('error', (error) => { init.signal?.removeEventListener('abort', abort); reject(error) }); request.end()
  })
}
async function readLimited(response, limit) {
  const declared = Number(header(response.headers, 'content-length'))
  if (Number.isFinite(declared) && declared > limit) throw new NationalAlarmUpstreamError('too-large')
  let size = 0; const chunks = []
  try { for await (const chunk of response.stream) { size += chunk.length; if (size > limit) throw new NationalAlarmUpstreamError('too-large'); chunks.push(chunk) } } catch (error) { if (error instanceof NationalAlarmUpstreamError) throw error; throw new NationalAlarmUpstreamError('network') }
  return Buffer.concat(chunks).toString('utf8')
}
function validatePage(payload) {
  const page = payload?.data?.page
  if (!object(payload) || payload.code !== 0 || !object(page) || page.pageNo !== 1 || page.pageSize !== 10000 || page.totalPage !== 1 || !Array.isArray(page.list) || !Number.isSafeInteger(page.count) || page.count < 0 || page.count !== page.list.length) throw new NationalAlarmUpstreamError('structure')
  return page.list
}
export function safeSourcePath(value) {
  if (typeof value !== 'string') return null
  try { const url = new URL(value, NMC_ORIGIN); return url.origin === NMC_ORIGIN && !url.search && !url.hash && SOURCE_PATH.test(url.pathname) ? url.pathname : null } catch { return null }
}
export function extractAlarmBody(html) {
  if (typeof html !== 'string') throw new NationalAlarmUpstreamError('detail-structure')
  // NMC's manually verified body container is currently <div id=alarmtext>.
  // Attributes may be quoted or unquoted and NMC may emit multiple body blocks.
  const blocks = [...html.matchAll(/<div\b[^>]*\bid\s*=\s*(?:["']alarmtext["']|alarmtext\b)[^>]*>([\s\S]*?)<\/div>/gi)].map((match) => match[1])
  if (!blocks.length) throw new NationalAlarmUpstreamError('detail-structure')
  // The first verified alarmtext block is the official warning. Later blocks are
  // NMC's defence-guide appendix and are intentionally outside this feature's scope.
  const text = blocks[0]
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/\s*p\s*>/gi, '\n')
    .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#39;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text || text.length > 4000) throw new NationalAlarmUpstreamError('detail-structure')
  return text
}
export function createNationalAlarmUpstream(config = {}, options = {}) {
  const transport = options.transport ?? (options.fetchImpl ? async (url, init) => responseFromFetch(await options.fetchImpl(url, init)) : nativeTransport)
  const timeoutMs = config.timeoutMs ?? 10_000
  async function request(url, accept, maxBytes, signal) {
    const controller = new AbortController(); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) controller.abort()
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new NationalAlarmUpstreamError('timeout')) }, timeoutMs) })
    try {
      // Race the transport as well as aborting it: DNS/connect stalls on Windows
      // must not leave an HTTP handler waiting past the documented hard deadline.
      const response = await Promise.race([transport(url, { method: 'GET', headers: { accept, 'accept-encoding': 'identity' }, signal: controller.signal, redirect: 'manual' }), timeout])
      if (response.redirected || response.status < 200 || response.status >= 300) throw new NationalAlarmUpstreamError(response.redirected ? 'redirect' : 'http')
      return await readLimited(response, maxBytes)
    } catch (error) {
      if (error instanceof NationalAlarmUpstreamError) throw error
      if (controller.signal.aborted || error?.name === 'AbortError') throw new NationalAlarmUpstreamError('timeout')
      throw new NationalAlarmUpstreamError('network')
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  return {
    async list(signal) { const raw = await request(fixedUrl(NMC_LIST_PATH, LIST_QUERY), 'application/json', config.listMaxBytes ?? 3 * 1024 * 1024, signal); try { return validatePage(JSON.parse(raw)) } catch (error) { if (error instanceof NationalAlarmUpstreamError) throw error; throw new NationalAlarmUpstreamError('json') } },
    async detail(sourcePath, signal) { if (!SOURCE_PATH.test(sourcePath ?? '')) throw new NationalAlarmUpstreamError('invalid-path'); return extractAlarmBody(await request(fixedUrl(sourcePath), 'text/html', config.detailMaxBytes ?? 512 * 1024, signal)) },
  }
}
