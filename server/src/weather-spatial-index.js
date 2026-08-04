import fs from 'node:fs'
import path from 'node:path'

export class WeatherSpatialError extends Error {
  constructor(kind, message) { super(message); this.name = 'WeatherSpatialError'; this.kind = kind }
}

const LEVELS = ['province', 'city', 'county', 'township', 'village']
function fail(message = '天气空间数据不可用') { throw new WeatherSpatialError('unconfigured', message) }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { fail() } }
function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) fail('天气边界引用无效')
  const target = path.resolve(root, relative), base = path.resolve(root)
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) fail('天气边界引用越界')
  return target
}
function finitePoint(point) { return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) }
function validRing(ring) { return Array.isArray(ring) && ring.length >= 4 && ring.every(finitePoint) && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1] }
function validGeometry(geometry) {
  if (geometry?.type === 'Polygon') return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every(validRing)
  if (geometry?.type === 'MultiPolygon') return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0 && geometry.coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(validRing))
  return false
}
function pointOnSegment([x, y], [a, b], [c, d]) {
  const cross = (x - a) * (d - b) - (y - b) * (c - a)
  return Math.abs(cross) <= 1e-10 && x >= Math.min(a, c) - 1e-10 && x <= Math.max(a, c) + 1e-10 && y >= Math.min(b, d) - 1e-10 && y <= Math.max(b, d) + 1e-10
}
function inRing(point, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i]
    if (pointOnSegment(point, a, b)) return true
    if ((b[1] > point[1]) !== (a[1] > point[1]) && point[0] < ((a[0] - b[0]) * (point[1] - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside
  }
  return inside
}
function inPolygon(point, polygon) { return inRing(point, polygon[0]) && !polygon.slice(1).some((ring) => inRing(point, ring)) }
export function geometryCovers(geometry, point) {
  if (!validGeometry(geometry) || !finitePoint(point)) return false
  return geometry.type === 'Polygon' ? inPolygon(point, geometry.coordinates) : geometry.coordinates.some((polygon) => inPolygon(point, polygon))
}

export function loadWeatherSpatialIndex(dataDir) {
  if (!dataDir) fail('WEATHER_DATA_DIR 未配置')
  const root = path.resolve(dataDir), index = readJson(path.join(root, 'weather', 'index-v2.json'))
  if (index?.schemaVersion !== 2 || index?.provinceCode !== '330000' || !Array.isArray(index.nodes) || index.nodes.length === 0) fail('天气空间索引版本无效')
  const rawNodes = new Map()
  for (const raw of index.nodes) {
    const code = typeof raw?.code === 'string' ? raw.code : '', children = raw?.childrenCodes
    if (!/^33\d{4,10}$/.test(code) || rawNodes.has(code) || !LEVELS.includes(raw?.level) || typeof raw?.name !== 'string' || !raw.name.trim() || !finitePoint(raw.representativePoint) || !Array.isArray(children) || children.some((child) => typeof child !== 'string') || new Set(children).size !== children.length) fail('天气空间索引节点无效')
    rawNodes.set(code, raw)
  }
  const roots = [...rawNodes.values()].filter((node) => node.parentCode === null)
  if (roots.length !== 1 || roots[0].code !== '330000' || roots[0].level !== 'province') fail('天气空间索引根节点无效')
  for (const node of rawNodes.values()) {
    const level = LEVELS.indexOf(node.level)
    if (level > 0) {
      const parent = rawNodes.get(node.parentCode)
      if (!parent || LEVELS.indexOf(parent.level) !== level - 1 || !parent.childrenCodes.includes(node.code)) fail('天气空间索引父子关系无效')
    }
    for (const childCode of node.childrenCodes) {
      const child = rawNodes.get(childCode)
      if (!child || child.parentCode !== node.code) fail('天气空间索引子节点无效')
    }
  }
  const visited = new Set(), stack = ['330000']
  while (stack.length) { const code = stack.pop(); if (visited.has(code)) fail('天气空间索引包含环'); visited.add(code); stack.push(...rawNodes.get(code).childrenCodes) }
  if (visited.size !== rawNodes.size) fail('天气空间索引存在不可达节点')

  const featureFiles = new Map(), verified = new Map()
  function featuresFor(relative) {
    if (!featureFiles.has(relative)) {
      const collection = readJson(safePath(root, relative))
      if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) fail('天气边界文件无效')
      const features = new Map()
      for (const feature of collection.features) {
        const code = typeof feature?.properties?.code === 'string' ? feature.properties.code : String(feature?.properties?.code ?? '')
        const name = typeof feature?.properties?.name === 'string' ? feature.properties.name.trim() : ''
        if (!code || !name || features.has(code) || !validGeometry(feature?.geometry)) fail('天气边界要素无效')
        features.set(code, { name, geometry: feature.geometry })
      }
      featureFiles.set(relative, features)
    }
    return featureFiles.get(relative)
  }
  for (const raw of rawNodes.values()) {
    const relative = raw.boundary?.path
    if (raw.boundary?.featureCode !== raw.code) fail('天气边界索引不一致')
    const feature = featuresFor(relative).get(raw.code)
    if (!feature || feature.name !== raw.name || !geometryCovers(feature.geometry, raw.representativePoint)) fail('天气索引名称、代表点与边界不一致')
    verified.set(raw.code, Object.freeze({ code: raw.code, name: raw.name, level: raw.level, parentCode: raw.parentCode, childrenCodes: Object.freeze([...raw.childrenCodes]), representativePoint: Object.freeze([...raw.representativePoint]), geometry: feature.geometry }))
  }
  const rootNode = verified.get('330000')
  for (const node of verified.values()) {
    if (!geometryCovers(rootNode.geometry, node.representativePoint)) fail('天气代表点越出浙江省界')
    let parent = node.parentCode ? verified.get(node.parentCode) : null
    while (parent) {
      if (!geometryCovers(parent.geometry, node.representativePoint)) fail('天气代表点越出父级行政链')
      parent = parent.parentCode ? verified.get(parent.parentCode) : null
    }
  }
  return Object.freeze({
    get(code, level) { const node = verified.get(code); if (!node || node.level !== level) throw new WeatherSpatialError('outside', '行政代码不属于当前层级或浙江省'); return node },
    covers(node, lon, lat) {
      if (verified.get(node?.code) !== node) return false
      const point = [lon, lat]
      if (!geometryCovers(rootNode.geometry, point)) return false
      let current = node
      while (current) {
        if (!geometryCovers(current.geometry, point)) return false
        current = current.parentCode ? verified.get(current.parentCode) : null
      }
      return true
    },
    province() { return rootNode },
    findAlarmNode(code) {
      const node = verified.get(code)
      return node && ['province', 'city', 'county'].includes(node.level) ? node : null
    },
    alertNodes(node) { if (verified.get(node?.code) !== node) fail('天气空间节点未验证'); if (node.level === 'province' || node.level === 'city') return node.childrenCodes.map((code) => verified.get(code)); return node.level === 'county' ? [node] : [] },
  })
}
