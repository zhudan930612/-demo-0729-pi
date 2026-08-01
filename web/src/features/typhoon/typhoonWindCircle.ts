import type { ObservationNode, WindRadius } from './typhoonTypes'

export type LatLon = readonly [lat: number, lon: number]
const EARTH_RADIUS_KM = 6371.0088

function destination(lat: number, lon: number, bearingDegrees: number, distanceKm: number): LatLon {
  const angularDistance = distanceKm / EARTH_RADIUS_KM
  const bearing = bearingDegrees * Math.PI / 180
  const lat1 = lat * Math.PI / 180
  const lon1 = lon * Math.PI / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing))
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2))
  return [lat2 * 180 / Math.PI, ((lon2 * 180 / Math.PI + 540) % 360) - 180]
}

function radiusForBearing(radius: WindRadius, bearing: number): number {
  if (bearing < 90) return radius.neRadiusKm
  if (bearing < 180) return radius.seRadiusKm
  if (bearing < 270) return radius.swRadiusKm
  return radius.nwRadiusKm
}

export function windCirclePolygon(node: Pick<ObservationNode, 'lat' | 'lon'>, radius: WindRadius, stepsPerQuadrant = 12): LatLon[] | null {
  if (!Number.isFinite(node.lat) || !Number.isFinite(node.lon) || node.lat < -90 || node.lat > 90 || node.lon < -180 || node.lon > 180
    || !Number.isInteger(stepsPerQuadrant) || stepsPerQuadrant < 1
    || [radius.neRadiusKm, radius.seRadiusKm, radius.swRadiusKm, radius.nwRadiusKm].some((value) => !Number.isFinite(value) || value <= 0)) return null
  const points: LatLon[] = []
  for (let step = 0; step < stepsPerQuadrant * 4; step += 1) {
    const bearing = step * 360 / (stepsPerQuadrant * 4)
    points.push(destination(node.lat, node.lon, bearing, radiusForBearing(radius, bearing)))
  }
  points.push(points[0]!)
  return points
}

export function windRadiusPriority(radius: Pick<WindRadius, 'grade' | 'gradeText'>): number {
  const text = `${radius.grade} ${radius.gradeText ?? ''}`
  if (/12|十二/.test(text)) return 3
  if (/10|十级/.test(text)) return 2
  if (/7|七/.test(text)) return 1
  return 0
}

export function sortWindRadiiInnerFirst(radii: readonly WindRadius[]): WindRadius[] {
  return [...radii].sort((left, right) => windRadiusPriority(right) - windRadiusPriority(left))
}
