import { loadNationalAlarmSpatialIndex } from './national-alarm-spatial-index.js'
import { createNationalAlarmUpstream, NationalAlarmUpstreamError, safeSourcePath } from './national-alarm-upstream.js'

const FIVE_MINUTES = 5 * 60_000
const FIFTEEN_MINUTES = 15 * 60_000
const ONE_MINUTE = 60_000
const LEVELS = new Set(['province', 'city', 'county'])
const EVENT_TYPES = ['暴雨', '暴雪', '台风', '大风', '寒潮', '高温', '干旱', '雷电', '冰雹', '霜冻', '大雾', '道路结冰', '沙尘暴']
const SEVERITIES = [['红色', 'red'], ['橙色', 'orange'], ['黄色', 'yellow'], ['蓝色', 'blue']]

export class NationalAlarmError extends Error {
  constructor(kind, message = '浙江预警数据暂不可用') { super(message); this.name = 'NationalAlarmError'; this.kind = kind }
}
function iso(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null }
function title(value) { if (typeof value !== 'string') return null; const cleaned = value.trim(); return cleaned && cleaned.length <= 500 && !/[\u0000-\u001F\u007F]/.test(cleaned) ? cleaned : null }
function id(value) { return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001F\u007F]/.test(value) ? value : null }
function adminCode(value) { const parsed = id(value)?.slice(0, 6) ?? ''; return /^\d{6}$/.test(parsed) ? parsed : null }
function iconUrl(value) {
  if (typeof value !== 'string') return null
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'image.nmc.cn' && !url.username && !url.password && !url.search && !url.hash ? url.toString() : null } catch { return null }
}
function eventType(value) { return EVENT_TYPES.find((name) => value.includes(name)) ?? null }
function severity(value) { return SEVERITIES.find(([name]) => value.includes(name))?.[1] ?? 'unknown' }
function publicRecord(record, node, groupCount) {
  const mapped = Boolean(node && LEVELS.has(node.level))
  return {
    id: record.id, issuedAt: record.issuedAt, title: record.title, iconUrl: record.iconUrl, adminCode: record.adminCode,
    adminLevel: mapped ? node.level : 'unknown', provinceCode: '33', provinceName: '浙江省', eventType: eventType(record.title), severity: severity(record.title), mappableInZhejiang: mapped,
    mapLocation: mapped ? { status: 'mapped', point: [...node.governmentSeatPoint], groupCount } : { status: 'unmapped' },
  }
}
function sorted(records) { return [...records].sort((a, b) => (Date.parse(b.issuedAt ?? 0) - Date.parse(a.issuedAt ?? 0)) || a.id.localeCompare(b.id)) }
function errorMessage(kind) { return kind === 'unavailable' ? '浙江预警数据暂不可用' : '预警正文暂不可用' }

export function normalizeNationalAlarms(rows, spatial) {
  if (!Array.isArray(rows)) throw new NationalAlarmError('structure')
  const raw = new Map()
  for (const source of rows) {
    const alertId = id(source?.alertid); const code = adminCode(alertId); const alarmTitle = title(source?.title)
    if (!alertId || !code || !alarmTitle) throw new NationalAlarmError('structure')
    const candidate = { id: alertId, adminCode: code, issuedAt: iso(source?.issuetime), title: alarmTitle, iconUrl: iconUrl(source?.pic), sourcePath: safeSourcePath(source?.url) }
    const existing = raw.get(alertId)
    // Any duplicate makes the advertised complete-page count unverifiable; retain nothing from this response.
    if (raw.has(alertId)) throw new NationalAlarmError('structure')
    raw.set(alertId, candidate)
  }
  const zhejiang = sorted([...raw.values()].filter((record) => record.adminCode.startsWith('33')))
  const groups = new Map(); const nodes = new Map()
  for (const record of zhejiang) { const node = spatial?.findAlarmNode(record.adminCode) ?? null; nodes.set(record.id, node); if (node) groups.set(record.adminCode, (groups.get(record.adminCode) ?? 0) + 1) }
  return { internal: zhejiang.map((record) => ({ ...record, node: nodes.get(record.id) ?? null })), items: zhejiang.map((record) => publicRecord(record, nodes.get(record.id), groups.get(record.adminCode) ?? 0)) }
}

export function createNationalAlarmService(config = {}, options = {}) {
  const now = options.now ?? Date.now
  const upstream = options.upstream ?? createNationalAlarmUpstream(config, options)
  const loadSpatial = options.loadSpatial ?? loadNationalAlarmSpatialIndex
  let spatial
  let spatialTask = null
  let snapshot = null
  let refreshTask = null
  let lastForcedAt = -Infinity
  const detailCache = new Map()
  const getSpatial = () => { if (!spatial) spatial = loadSpatial(config.dataDir, config.seatsFile || undefined); return spatial }
  async function getSpatialAsync() {
    if (spatial) return spatial
    if (!spatialTask) spatialTask = Promise.resolve().then(getSpatial)
    try { return await spatialTask } finally { spatialTask = null }
  }
  const validSnapshot = () => snapshot && now() - snapshot.fetchedMs <= FIFTEEN_MINUTES
  function serializable(stale = false, refreshError = null) {
    if (!snapshot) throw new NationalAlarmError('unavailable')
    return { items: snapshot.items, summary: { total: snapshot.items.length, snapshotTotal: snapshot.items.length }, fetchedAt: snapshot.fetchedAt, expiresAt: new Date(snapshot.fetchedMs + FIVE_MINUTES).toISOString(), source: '中央气象台（NMC），仅展示浙江省预警', ...(stale ? { stale: true, refreshError: { code: 'NATIONAL_ALARM_REFRESH_FAILED', message: errorMessage('unavailable') } } : {}), ...(refreshError ? { refreshError } : {}) }
  }
  function invalidateDetails(nextInternal) {
    const versions = new Map(nextInternal.map((record) => [record.id, `${record.id}\u0000${record.title}\u0000${record.issuedAt ?? ''}`]))
    for (const [key, cached] of detailCache) if (versions.get(cached.id) !== cached.version) detailCache.delete(key)
  }
  async function refresh() {
    if (refreshTask) return refreshTask
    refreshTask = (async () => {
      try {
        // Cold spatial validation is expensive; overlap it with NMC network I/O.
        const [rows, verifiedSpatial] = await Promise.all([upstream.list(), getSpatialAsync()])
        const normalized = normalizeNationalAlarms(rows, verifiedSpatial)
        invalidateDetails(normalized.internal)
        snapshot = { ...normalized, fetchedMs: now(), fetchedAt: new Date(now()).toISOString() }
        return serializable()
      } finally { refreshTask = null }
    })()
    return refreshTask
  }
  async function list() {
    if (snapshot) {
      if (validSnapshot()) return serializable(now() - snapshot.fetchedMs > FIVE_MINUTES)
      throw new NationalAlarmError('unavailable')
    }
    try { return await refresh() } catch (error) { throw error instanceof NationalAlarmError || error instanceof NationalAlarmUpstreamError ? new NationalAlarmError('unavailable') : error }
  }
  async function forceRefresh() {
    if (snapshot && now() - lastForcedAt < ONE_MINUTE) return serializable()
    lastForcedAt = now()
    try { return await refresh() } catch (error) { if (validSnapshot()) return serializable(true); throw new NationalAlarmError('unavailable') }
  }
  async function detail(alertId) {
    if (!snapshot) throw new NationalAlarmError('not-found')
    const record = snapshot.internal.find((item) => item.id === alertId)
    if (!record || !record.sourcePath) throw new NationalAlarmError('not-found')
    const version = `${record.id}\u0000${record.title}\u0000${record.issuedAt ?? ''}`
    const cached = detailCache.get(version)
    if (cached) return cached.promise
    const promise = upstream.detail(record.sourcePath).then((body) => ({ id: record.id, issuedAt: record.issuedAt, body })).catch((error) => { detailCache.delete(version); throw new NationalAlarmError('detail-unavailable') })
    detailCache.set(version, { id: record.id, version, promise })
    return promise
  }
  return { list, forceRefresh, detail, stats: () => ({ hasSnapshot: Boolean(snapshot), itemCount: snapshot?.items.length ?? 0, refreshing: Boolean(refreshTask) }) }
}
