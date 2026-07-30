import area from '@turf/area'
import booleanWithin from '@turf/boolean-within'
import { featureCollection, polygon } from '@turf/helpers'
import intersect from '@turf/intersect'
import kinks from '@turf/kinks'
import pointOnFeature from '@turf/point-on-feature'
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from 'geojson'

export const M2_PER_MU = 2000 / 3
const MIN_AREA_M2 = 0.01

export interface PreparedManualGeometry {
  geometry: Polygon
  areaM2: number
  areaMu: number
  labelLng: number
  labelLat: number
}

export interface GeometryCheckResult {
  prepared?: PreparedManualGeometry
  error?: string
}

export interface ManualParcelWarnings {
  overlapCount: number
  outsideVillage: boolean
  incompleteChecks: number
}

function samePosition(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1]
}

/** 去除连续重复点并闭合外环。V1 只接受无孔单 Polygon。 */
export function normalizeOuterRing(points: Position[]): Position[] {
  const clean: Position[] = []
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) continue
    const next: Position = [Number(point[0]), Number(point[1])]
    if (!clean.length || !samePosition(clean[clean.length - 1], next)) clean.push(next)
  }
  if (clean.length > 1 && samePosition(clean[0], clean[clean.length - 1])) clean.pop()
  if (clean.length) clean.push([...clean[0]])
  return clean
}

export function prepareManualGeometry(points: Position[]): GeometryCheckResult {
  const ring = normalizeOuterRing(points)
  const vertices = ring.slice(0, -1)
  if (vertices.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90)) {
    return { error: '地块包含无效坐标，请调整顶点后重试。' }
  }
  const distinct = new Set(vertices.map(([lng, lat]) => `${lng},${lat}`))
  if (distinct.size < 3) return { error: '至少需要 3 个不同的顶点才能保存地块。' }

  try {
    const feature = polygon([ring])
    if (kinks(feature).features.length > 0) return { error: '地块边界存在自相交，请拖动顶点消除交叉。' }
    const areaM2 = area(feature)
    if (!Number.isFinite(areaM2) || areaM2 <= MIN_AREA_M2) return { error: '地块面积为零或无法计算，请调整顶点。' }
    const label = pointOnFeature(feature).geometry.coordinates
    return {
      prepared: {
        geometry: feature.geometry,
        areaM2,
        areaMu: areaM2 / M2_PER_MU,
        labelLng: label[0],
        labelLat: label[1],
      },
    }
  } catch {
    return { error: '地块几何无效，请调整顶点后重试。' }
  }
}

function isAreaGeometry(geometry: Geometry | null | undefined): geometry is Polygon | MultiPolygon {
  return geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon'
}

export function inspectManualGeometry(
  geometry: Polygon,
  villageGeometry: Geometry | null | undefined,
  otherFeatures: Feature[],
): ManualParcelWarnings {
  const candidate = { type: 'Feature', properties: {}, geometry } as Feature<Polygon>
  let outsideVillage = false
  let incompleteChecks = 0

  if (isAreaGeometry(villageGeometry)) {
    try {
      outsideVillage = !booleanWithin(candidate, { type: 'Feature', properties: {}, geometry: villageGeometry })
    } catch {
      incompleteChecks += 1
    }
  } else {
    incompleteChecks += 1
  }

  let overlapCount = 0
  for (const other of otherFeatures) {
    if (!isAreaGeometry(other.geometry)) continue
    try {
      const hit = intersect(featureCollection([candidate, other as Feature<Polygon | MultiPolygon>]))
      if (hit && area(hit) > MIN_AREA_M2) overlapCount += 1
    } catch {
      incompleteChecks += 1
    }
  }
  return { overlapCount, outsideVillage, incompleteChecks }
}
