import fs from 'node:fs'
import path from 'node:path'
import { geometryCovers, WeatherSpatialError } from './weather-spatial-index.js'

const TARGET_LEVELS = new Set(['province', 'city', 'county'])
function fail(message = '浙江预警空间数据不可用') { throw new WeatherSpatialError('unconfigured', message) }
function json(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { fail() } }
function point(value) { return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) }
function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('预警边界引用无效')
  const base = path.resolve(root), resolved = path.resolve(base, relative)
  if (!resolved.startsWith(`${base}${path.sep}`)) fail('预警边界引用越界')
  return resolved
}

// Alert placement only needs province/city/county records. Loading all 35k township
// and village features delayed the first NMC response by about a minute.
export function loadNationalAlarmSpatialIndex(dataDir) {
  if (!dataDir) fail('WEATHER_DATA_DIR 未配置')
  const root = path.resolve(dataDir), index = json(path.join(root, 'weather', 'index-v2.json'))
  if (index?.schemaVersion !== 2 || index?.provinceCode !== '330000' || !Array.isArray(index.nodes)) fail('预警空间索引版本无效')
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
    const parent = node.parentCode === null ? null : raw.get(node.parentCode)
    if (node.level === 'province') { if (node.code !== '330000' || node.parentCode !== null) fail('预警空间索引根节点无效') }
    else if (!parent || !TARGET_LEVELS.has(parent.level) || !Array.isArray(parent.childrenCodes) || !parent.childrenCodes.includes(node.code)) fail('预警空间索引层级无效')
    verified.set(node.code, Object.freeze({ code: node.code, name: node.name, level: node.level, parentCode: node.parentCode, representativePoint: Object.freeze([...node.representativePoint]), geometry }))
  }
  const province = verified.get('330000'); if (!province) fail('预警空间索引缺少浙江省')
  for (const node of verified.values()) {
    if (!geometryCovers(province.geometry, node.representativePoint)) fail('预警代表点越出浙江省界')
    const parent = node.parentCode ? verified.get(node.parentCode) : null
    if (parent && !geometryCovers(parent.geometry, node.representativePoint)) fail('预警代表点越出父级边界')
  }
  return Object.freeze({ findAlarmNode(code) { return verified.get(code) ?? null } })
}
