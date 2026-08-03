import fs from 'node:fs'
import path from 'node:path'

export class WeatherSpatialError extends Error {
  constructor(kind, message) { super(message); this.name = 'WeatherSpatialError'; this.kind = kind }
}

const LEVELS = ['province', 'city', 'county', 'township', 'village']

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { throw new WeatherSpatialError('unconfigured', '天气空间数据不可用') }
}
function safePath(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new WeatherSpatialError('unconfigured', '天气边界引用无效')
  const target = path.resolve(root, relative)
  if (target !== path.resolve(root) && !target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new WeatherSpatialError('unconfigured', '天气边界引用越界')
  return target
}
function finitePoint(point) { return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) }
function pointOnSegment([x, y], [a, b], [c, d]) {
  const cross = (x - a) * (d - b) - (y - b) * (c - a)
  return Math.abs(cross) <= 1e-10 && x >= Math.min(a, c) - 1e-10 && x <= Math.max(a, c) + 1e-10 && y >= Math.min(b, d) - 1e-10 && y <= Math.max(b, d) + 1e-10
}
function inRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 4) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j], b = ring[i]
    if (!finitePoint(a) || !finitePoint(b)) throw new WeatherSpatialError('unconfigured', '天气边界坐标无效')
    if (pointOnSegment(point, a, b)) return true
    if ((b[1] > point[1]) !== (a[1] > point[1]) && point[0] < ((a[0] - b[0]) * (point[1] - b[1])) / (a[1] - b[1]) + b[0]) inside = !inside
  }
  return inside
}
function inPolygon(point, polygon) { return Array.isArray(polygon) && polygon.length > 0 && inRing(point, polygon[0]) && !polygon.slice(1).some((ring) => inRing(point, ring)) }
export function geometryCovers(geometry, point) {
  if (!geometry || !finitePoint(point)) return false
  if (geometry.type === 'Polygon') return inPolygon(point, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return Array.isArray(geometry.coordinates) && geometry.coordinates.some((polygon) => inPolygon(point, polygon))
  return false
}

export function loadWeatherSpatialIndex(dataDir) {
  if (!dataDir) throw new WeatherSpatialError('unconfigured', 'WEATHER_DATA_DIR 未配置')
  const root = path.resolve(dataDir)
  const index = readJson(path.join(root, 'weather', 'index-v1.json'))
  if (index?.schemaVersion !== 1 || index?.provinceCode !== '330000' || !Array.isArray(index.nodes)) throw new WeatherSpatialError('unconfigured', '天气空间索引版本无效')
  const nodes = new Map()
  for (const raw of index.nodes) {
    const code = typeof raw?.code === 'string' ? raw.code : ''
    if (!/^33\d{4,10}$/.test(code) || nodes.has(code) || !LEVELS.includes(raw.level) || !finitePoint(raw.representativePoint) || !Array.isArray(raw.childrenCodes)) throw new WeatherSpatialError('unconfigured', '天气空间索引节点无效')
    nodes.set(code, Object.freeze({ ...raw }))
  }
  const rootNode = nodes.get('330000')
  if (!rootNode || rootNode.level !== 'province' || rootNode.parentCode !== null) throw new WeatherSpatialError('unconfigured', '天气空间索引根节点无效')
  for (const node of nodes.values()) {
    const level = LEVELS.indexOf(node.level)
    if (level > 0) {
      const parent = nodes.get(node.parentCode)
      if (!parent || LEVELS.indexOf(parent.level) !== level - 1 || !parent.childrenCodes.includes(node.code)) throw new WeatherSpatialError('unconfigured', '天气空间索引父子关系无效')
    }
    for (const code of node.childrenCodes) if (nodes.get(code)?.parentCode !== node.code) throw new WeatherSpatialError('unconfigured', '天气空间索引子节点无效')
  }

  const featureFiles = new Map()
  function geometryFor(node) {
    const relative = node.boundary?.path
    if (node.boundary?.featureCode !== node.code) throw new WeatherSpatialError('unconfigured', '天气边界索引不一致')
    if (!featureFiles.has(relative)) {
      const collection = readJson(safePath(root, relative))
      if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) throw new WeatherSpatialError('unconfigured', '天气边界文件无效')
      const features = new Map()
      for (const feature of collection.features) {
        const code = String(feature?.properties?.code ?? '')
        if (!code || features.has(code) || !['Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)) throw new WeatherSpatialError('unconfigured', '天气边界要素无效')
        features.set(code, feature.geometry)
      }
      featureFiles.set(relative, features)
    }
    const geometry = featureFiles.get(relative).get(node.code)
    if (!geometry || !geometryCovers(geometry, node.representativePoint)) throw new WeatherSpatialError('unconfigured', '天气代表点与边界不一致')
    return geometry
  }
  return {
    get(code, level) {
      const node = nodes.get(code)
      if (!node || node.level !== level) throw new WeatherSpatialError('outside', '行政代码不属于当前层级或浙江省')
      return node
    },
    covers(node, lon, lat) { return geometryCovers(geometryFor(node), [lon, lat]) },
    province() { return rootNode },
    alertNodes(node) {
      if (node.level === 'province' || node.level === 'city') return node.childrenCodes.map((code) => nodes.get(code))
      if (node.level === 'county') return [node]
      return []
    },
  }
}
