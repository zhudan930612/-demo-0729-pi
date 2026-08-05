import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { geometryCovers, WeatherSpatialError } from './weather-spatial-index.js'

// 实时天气多级政府驻地标牌索引：消费 server/data/government-seats-v1.json 与已验证的
// 天气空间索引，提供按当前行政节点返回子级政府驻地天气目标的方法。
// 与预警索引（national-alarm-spatial-index.js）的区别：本索引覆盖乡镇层，是
// 实时天气标牌的可信坐标来源；与行政代表点索引（weather-spatial-index.js）
// 的区别：不加载村界（省/市/县/乡镇共 1492 个节点，避免村级 ~35k 要素导致首次响应过慢）。
const TARGET_LEVELS = new Set(['province', 'city', 'county', 'township'])
const SCORE_THRESHOLDS = { province: 99, city: 99, county: 99, township: 60 }
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOVERNMENT_SEATS_FILE = 'government-seats-v1.json'
function fail(message = '天气驻地空间数据不可用') { throw new WeatherSpatialError('unconfigured', message) }
function json(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { fail() } }
function point(value) { return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) }
function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('天气驻地边界引用无效')
  const base = path.resolve(root), resolved = path.resolve(base, relative)
  if (!resolved.startsWith(`${base}${path.sep}`)) fail('天气驻地边界引用越界')
  return resolved
}
function scoreFor(level) { return SCORE_THRESHOLDS[level] ?? 99 }

function governmentSeats(seatsFile) {
  // 与预警索引共用受控版本化资产（仓库内 server/data/），可用 GOVERNMENT_SEATS_FILE 覆盖（相对 SERVER_DIR 解析）。
  const resolved = seatsFile ? safePath(SERVER_DIR, seatsFile) : path.join(SERVER_DIR, 'data', GOVERNMENT_SEATS_FILE)
  const payload = json(resolved)
  if (payload?.schemaVersion !== 1 || payload?.provinceCode !== '330000' || !Array.isArray(payload.entries)) fail('政府驻地坐标表无效')
  const seats = new Map()
  for (const entry of payload.entries) {
    if (!TARGET_LEVELS.has(entry.level)) continue
    if (typeof entry?.code !== 'string' || typeof entry.name !== 'string' || !entry.name.trim() || seats.has(entry.code)) fail('政府驻地坐标记录无效')
    seats.set(entry.code, entry)
  }
  return seats
}

/**
 * 加载政府驻地实时天气索引。fail closed：
 * - 空间索引/边界/驻地表任一损坏、版本或引用无效即拒绝加载；
 * - 驻地表只接受 candidate；省/市/县 score >= 99，乡镇 score >= 60；
 * - 候选坐标必须为有限数值，且位于自身行政面、完整父级链与浙江省界共同范围内；
 * - 任何校验失败不降级（不用面中心、代表点或包围盒补位），该目标被跳过并记录诊断分类。
 */
export function loadWeatherSeatIndex(dataDir, seatsFile) {
  if (!dataDir) fail('WEATHER_DATA_DIR 未配置')
  const root = path.resolve(dataDir)
  const index = json(path.join(root, 'weather', 'index-v2.json'))
  if (index?.schemaVersion !== 2 || index?.provinceCode !== '330000' || !Array.isArray(index.nodes)) fail('天气驻地空间索引版本无效')
  const seats = governmentSeats(seatsFile)
  const raw = new Map()
  for (const node of index.nodes) {
    if (typeof node?.code !== 'string' || !/^33\d{4,10}$/.test(node.code) || raw.has(node.code)) fail('天气驻地空间索引节点无效')
    raw.set(node.code, node)
  }
  const picked = [...raw.values()].filter((node) => TARGET_LEVELS.has(node.level))
  const verified = new Map(), files = new Map(), skippedByParent = new Map()
  function featureFor(node) {
    const relative = node?.boundary?.path
    if (node?.boundary?.featureCode !== node.code || typeof node.name !== 'string' || !node.name.trim() || !point(node.representativePoint)) fail('天气驻地空间索引节点无效')
    if (!files.has(relative)) {
      const collection = json(safePath(root, relative))
      if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) fail('天气驻地边界文件无效')
      files.set(relative, new Map(collection.features.map((feature) => [String(feature?.properties?.code ?? ''), feature])))
    }
    const feature = files.get(relative).get(node.code)
    if (!feature || feature?.properties?.name !== node.name || !geometryCovers(feature.geometry, node.representativePoint)) fail('天气驻地边界、名称或代表点无效')
    return feature.geometry
  }
  function skip(node, reason) {
    const parent = node.parentCode ?? ''
    const perReason = skippedByParent.get(parent) ?? new Map()
    const list = perReason.get(reason) ?? []; list.push(node.code); perReason.set(reason, list)
    skippedByParent.set(parent, perReason)
  }
  for (const node of picked) {
    const geometry = featureFor(node)
    const seat = seats.get(node.code)
    if (!seat || seat.level !== node.level || seat.name !== node.name) { skip(node, 'missing-or-mismatch'); continue }
    if (seat.status !== 'candidate' || !Number.isFinite(seat.score) || seat.score < scoreFor(node.level)) { skip(node, 'not-candidate'); continue }
    if (!point(seat.point) || !geometryCovers(geometry, seat.point)) { skip(node, 'out-of-boundary'); continue }
    verified.set(node.code, Object.freeze({ code: node.code, name: node.name, level: node.level, parentCode: node.parentCode, representativePoint: Object.freeze([...node.representativePoint]), point: Object.freeze([...seat.point]), geometry }))
  }
  const province = verified.get('330000')
  if (!province) fail('天气驻地索引缺少浙江省')
  // 省外与父链越界：按父链自顶向下剔除，父被剔除则子一并剔除。
  const removed = new Set()
  for (const node of [...verified.values()].sort((a, b) => a.code.localeCompare(b.code))) {
    if (removed.has(node.code)) continue
    if (node.level === 'province') continue
    if (!geometryCovers(province.geometry, node.point)) { skip(node, 'out-of-province'); removed.add(node.code); verified.delete(node.code); continue }
    let parent = node.parentCode ? raw.get(node.parentCode) : null
    let chainOk = true
    while (parent) {
      if (removed.has(parent.code)) { chainOk = false; break }
      const parentVerified = verified.get(parent.code)
      if (!parentVerified || !geometryCovers(parentVerified.geometry, node.point)) { chainOk = false; break }
      parent = parent.parentCode ? raw.get(parent.parentCode) : null
    }
    if (!chainOk) { skip(node, 'out-of-parent-chain'); removed.add(node.code); verified.delete(node.code) }
  }
  const byLevel = new Map()
  for (const node of verified.values()) {
    const list = byLevel.get(node.level) ?? []; list.push(node); byLevel.set(node.level, list)
  }
  const rootNode = verified.get('330000')
  return Object.freeze({
    get(code, level) {
      const node = verified.get(code)
      if (!node || node.level !== level) throw new WeatherSpatialError('outside', '行政代码不属于当前层级或浙江省')
      return node
    },
    seatFor(node) { return verified.get(node?.code) ?? null },
    province() { return rootNode },
    /** 当前节点的子级政府驻地天气目标：省 -> 市、市 -> 县、县 -> 乡镇；乡镇/村无子级目标。 */
    children(node) {
      const level = node?.level
      if (level === 'province' || level === 'city' || level === 'county') {
        const current = verified.get(node?.code)
        if (!current || current.level !== level) fail('天气驻地节点未验证')
      } else if (level !== 'township' && level !== 'village') {
        fail('天气驻地层级无效')
      }
      const childLevel = level === 'province' ? 'city' : level === 'city' ? 'county' : level === 'county' ? 'township' : null
      if (!childLevel) return { targets: [], diagnostics: {} }
      const targets = (byLevel.get(childLevel) ?? []).filter((child) => child.parentCode === node.code)
      const rawDiagnostics = skippedByParent.get(node.code) ?? new Map()
      const diagnostics = Object.fromEntries([...rawDiagnostics].map(([reason, codes]) => [reason, codes.length]))
      return { targets, diagnostics }
    },
  })
}
