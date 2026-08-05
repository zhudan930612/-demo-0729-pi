import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { geometryCovers, WeatherSpatialError } from './weather-spatial-index.js'

const TARGET_LEVELS = new Set(['province', 'city', 'county'])
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOVERNMENT_SEATS_FILE = 'government-seats-v1.json'
function fail(message = '浙江预警空间数据不可用') { throw new WeatherSpatialError('unconfigured', message) }
function json(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { fail() } }
function point(value) { return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) }
function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('预警边界引用无效')
  const base = path.resolve(root), resolved = path.resolve(base, relative)
  if (!resolved.startsWith(`${base}${path.sep}`)) fail('预警边界引用越界')
  return resolved
}
function governmentSeats(root, seatsFile) {
  // 政府驻地表是受控版本化资产（仓库内 server/data/），不随 WEATHER_DATA_DIR 走：
  // 默认读 SERVER_DIR/data/government-seats-v1.json，可用 GOVERNMENT_SEATS_FILE 覆盖（相对 SERVER_DIR 解析）。
  const resolved = seatsFile ? safePath(SERVER_DIR, seatsFile) : path.join(SERVER_DIR, 'data', GOVERNMENT_SEATS_FILE)
  const payload = json(resolved)
  if (payload?.schemaVersion !== 1 || payload?.provinceCode !== '330000' || !Array.isArray(payload.entries)) fail('政府驻地坐标表无效')
  const seats = new Map()
  for (const entry of payload.entries) {
    // The table may carry township/village entries (future data-source reserve);
    // the alarm index only consumes province/city/county and ignores the rest.
    if (!TARGET_LEVELS.has(entry.level)) continue
    if (typeof entry?.code !== 'string' || typeof entry.name !== 'string' || !entry.name.trim() || !point(entry.point) || entry.status !== 'candidate' || !Number.isFinite(entry.score) || entry.score < 99 || seats.has(entry.code)) fail('政府驻地坐标记录无效')
    seats.set(entry.code, entry)
  }
  return seats
}

// Alert placement only needs province/city/county records. Loading all 35k township
// and village features delayed the first NMC response by about a minute.
export function loadNationalAlarmSpatialIndex(dataDir, seatsFile) {
  if (!dataDir) fail('WEATHER_DATA_DIR 未配置')
  const root = path.resolve(dataDir), index = json(path.join(root, 'weather', 'index-v2.json'))
  if (index?.schemaVersion !== 2 || index?.provinceCode !== '330000' || !Array.isArray(index.nodes)) fail('预警空间索引版本无效')
  const seats = governmentSeats(root, seatsFile)
  const raw = new Map()
  for (const node of index.nodes) {
    if (typeof node?.code !== 'string' || !/^33\d{4,10}$/.test(node.code) || raw.has(node.code)) fail('预警空间索引节点无效')
    raw.set(node.code, node)
  }
  const picked = [...raw.values()].filter((node) => TARGET_LEVELS.has(node.level))
  const verified = new Map(), files = new Map()
  function featureFor(node) {
    const relative = node?.boundary?.path
    if (node?.boundary?.featureCode !== node.code || typeof node.name !== 'string' || !node.name.trim() || !point(node.representativePoint)) fail('预警空间索引节点无效')
    if (!files.has(relative)) {
      const collection = json(safePath(root, relative))
      if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) fail('预警边界文件无效')
      files.set(relative, new Map(collection.features.map((feature) => [String(feature?.properties?.code ?? ''), feature])))
    }
    const feature = files.get(relative).get(node.code)
    if (!feature || feature?.properties?.name !== node.name || !geometryCovers(feature.geometry, node.representativePoint)) fail('预警边界、名称或代表点无效')
    return feature.geometry
  }
  for (const node of picked) {
    const geometry = featureFor(node)
    const seat = seats.get(node.code)
    if (!seat || seat.level !== node.level || seat.name !== node.name || !geometryCovers(geometry, seat.point)) fail('政府驻地坐标越出行政边界或缺失')
    const parent = node.parentCode === null ? null : raw.get(node.parentCode)
    if (node.level === 'province') { if (node.code !== '330000' || node.parentCode !== null) fail('预警空间索引根节点无效') }
    else if (!parent || !TARGET_LEVELS.has(parent.level) || !Array.isArray(parent.childrenCodes) || !parent.childrenCodes.includes(node.code)) fail('预警空间索引层级无效')
    verified.set(node.code, Object.freeze({ code: node.code, name: node.name, level: node.level, parentCode: node.parentCode, representativePoint: Object.freeze([...node.representativePoint]), governmentSeatPoint: Object.freeze([...seat.point]), geometry }))
  }
  const province = verified.get('330000'); if (!province) fail('预警空间索引缺少浙江省')
  for (const node of verified.values()) {
    if (!geometryCovers(province.geometry, node.representativePoint) || !geometryCovers(province.geometry, node.governmentSeatPoint)) fail('预警点位越出浙江省界')
    const parent = node.parentCode ? verified.get(node.parentCode) : null
    if (parent && (!geometryCovers(parent.geometry, node.representativePoint) || !geometryCovers(parent.geometry, node.governmentSeatPoint))) fail('预警点位越出父级边界')
  }
  return Object.freeze({ findAlarmNode(code) { return verified.get(code) ?? null } })
}
