/**
 * 受灾预警 V1 —— 历史归档降雨取数工具（开发期，ADR-0009）
 *
 * 仅作开发期取数：把 Open-Meteo 历史归档（ERA5）按浙江 0.25° 网格逐小时降水拉回，
 * 供 scripts/ 固化静态产物使用。**不进运行链路**——受灾预警模式运行期零网络依赖，
 * 前端只消费 web/public/data/disaster/ 的静态产物。
 *
 * 与 precipitation-service.js 同模式：超时 / 字节上限 / 结构校验 / 可注入 fetchImpl。
 * 区别：端点 archive-api.open-meteo.com/v1/archive、固定历史时段、返回逐小时而非 7 日聚合。
 */

// 浙江 0.25° 网格（与降水服务同矩形；archive 端点同样支持多坐标逗号语法）
export const DISASTER_GRID = Object.freeze({
  lonMin: 118.0, lonMax: 123.0, latMin: 27.0, latMax: 31.5, step: 0.25,
})
export const DISASTER_WINDOW = Object.freeze({ start: '2026-07-09', end: '2026-07-13' })
export const UPSTREAM_URL = 'https://archive-api.open-meteo.com/v1/archive'
const REQUEST_TIMEOUT_MS = 280_000 // 实测全网格单请求约 98s，超时给足余量
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024
const CHUNK_SIZE = 50 // 与 scripts 取数脚本一致的分块（避免单 URL 过长）

export class DisasterPrecipError extends Error {
  constructor(kind, message, options = {}) { super(message); this.name = 'DisasterPrecipError'; this.kind = kind; this.status = options.status }
}

function round3(value) { return Math.round((value + Number.EPSILON) * 1000) / 1000 }

export function buildDisasterGrid() {
  const lons = [], lats = []
  for (let lon = DISASTER_GRID.lonMin; lon <= DISASTER_GRID.lonMax + 1e-9; lon += DISASTER_GRID.step) lons.push(round3(lon))
  for (let lat = DISASTER_GRID.latMin; lat <= DISASTER_GRID.latMax + 1e-9; lat += DISASTER_GRID.step) lats.push(round3(lat))
  return { lons, lats, pointCount: lats.length * lons.length }
}

/**
 * 创建历史归档取数工具。
 * snapshot(signal) → { grid: [{lat, lon, hourly: number[]}], hours: number,
 *   start, end, model, updatedAt }
 * grid 使用接口返回的吸附 lat/lon（非请求坐标，去重后 398 个唯一节点）。
 */
export function createDisasterPrecipService(config = {}, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const start = config.start ?? DISASTER_WINDOW.start
  const end = config.end ?? DISASTER_WINDOW.end

  async function fetchChunk(lats, lons, signal) {
    const params = new URLSearchParams()
    params.set('latitude', lats.join(','))
    params.set('longitude', lons.join(','))
    params.set('start_date', start)
    params.set('end_date', end)
    params.set('hourly', 'precipitation')
    params.set('timezone', 'Asia/Shanghai')
    const url = `${UPSTREAM_URL}?${params.toString()}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DisasterPrecipError('timeout', '历史降雨上游响应超时')), REQUEST_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      let response
      try {
        response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'agri-insurance-demo/1.0' } })
      } catch (error) {
        if (error?.name === 'AbortError') {
          if (controller.signal.reason instanceof DisasterPrecipError) throw controller.signal.reason
          throw new DisasterPrecipError(signal?.aborted ? 'aborted' : 'timeout', signal?.aborted ? '历史降雨请求已取消' : '历史降雨上游响应超时')
        }
        throw new DisasterPrecipError('network', '历史降雨上游网络错误')
      }
      if (!response.ok) throw new DisasterPrecipError('http', `历史降雨上游返回 ${response.status}`, { status: response.status })
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > MAX_RESPONSE_BYTES) throw new DisasterPrecipError('too-large', '历史降雨响应过大')
      const raw = await response.text()
      if (raw.length > MAX_RESPONSE_BYTES) throw new DisasterPrecipError('too-large', '历史降雨响应过大')
      let payload
      try { payload = JSON.parse(raw) } catch { throw new DisasterPrecipError('structure', '历史降雨响应结构异常') }
      const items = Array.isArray(payload) ? payload : [payload]
      if (items.length !== lats.length) throw new DisasterPrecipError('structure', '历史降雨点数与请求不符')
      return items
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  async function snapshot(signal) {
    const { lats, lons } = buildDisasterGrid()
    // 全部请求点（纬度外层 × 经度内层，399 对）
    const pairs = []
    for (const lat of lats) for (const lon of lons) pairs.push([lat, lon])
    const nodes = new Map()
    for (let i = 0; i < pairs.length; i += CHUNK_SIZE) {
      const chunk = pairs.slice(i, i + CHUNK_SIZE)
      const items = await fetchChunk(chunk.map((p) => p[0]), chunk.map((p) => p[1]), signal)
      for (const item of items) {
        const valid = item && typeof item.latitude === 'number' && typeof item.longitude === 'number'
          && Array.isArray(item.hourly?.time) && Array.isArray(item.hourly?.precipitation)
        if (!valid) throw new DisasterPrecipError('structure', '历史降雨单项结构异常')
        const key = `${round3(item.latitude)},${round3(item.longitude)}`
        if (!nodes.has(key)) nodes.set(key, { lat: round3(item.latitude), lon: round3(item.longitude), hourly: item.hourly.precipitation })
      }
    }
    const grid = [...nodes.values()]
    const hours = grid[0]?.hourly?.length ?? 0
    if (hours < 120) throw new DisasterPrecipError('structure', '历史降雨时次不足')
    return {
      grid,
      hours,
      start,
      end,
      model: 'ERA5 0.25° (Open-Meteo archive)',
      updatedAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19) + '+08:00',
    }
  }

  return { snapshot, grid: buildDisasterGrid() }
}
