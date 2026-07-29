import type { Geometry, Position } from 'geojson'

/** 射线法: 点是否在环内 */
function pointInRing(pt: Position, ring: Position[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** 点在 Polygon 内(外环内且不在孔内) */
function pointInPolygon(pt: Position, coords: Position[][]): boolean {
  if (!coords.length || !pointInRing(pt, coords[0])) return false
  for (let k = 1; k < coords.length; k++) {
    if (pointInRing(pt, coords[k])) return false
  }
  return true
}

/** 点在 Polygon/MultiPolygon 几何内 */
export function pointInGeometry(pt: Position, geom: Geometry | null | undefined): boolean {
  if (!geom) return false
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates)
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some((c) => pointInPolygon(pt, c))
  }
  return false
}
