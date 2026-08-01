import { describe, expect, it } from 'vitest'
import { sortWindRadiiInnerFirst, windCirclePolygon } from './typhoonWindCircle'
import type { WindRadius } from './typhoonTypes'

function radius(grade: string, ne: number, se: number, sw: number, nw: number): WindRadius {
  return { grade, gradeText: grade, neRadiusKm: ne, seRadiusKm: se, swRadiusKm: sw, nwRadiusKm: nw }
}

describe('wind circle geometry', () => {
  it('使用 NE/SE/SW/NW 四象限生成不规则闭合多边形', () => {
    const polygon = windCirclePolygon({ lat: 20, lon: 120 }, radius('七级', 400, 300, 200, 100), 1)!
    expect(polygon).toHaveLength(5)
    const distances = polygon.slice(0, 4).map(([lat, lon]) => Math.hypot(lat - 20, lon - 120))
    expect(new Set(distances.map((value) => value.toFixed(3))).size).toBe(4)
    expect(polygon[4]).toEqual(polygon[0])
  })

  it('非法/缺失四象限半径不推算', () => {
    expect(windCirclePolygon({ lat: 20, lon: 120 }, radius('七级', 100, 0, 100, 100))).toBeNull()
  })

  it('不读取 avg_radius 替代象限半径', () => {
    const raw = { ...radius('七级', 100, 0, 100, 100), avg_radius_km: 500 }
    expect(windCirclePolygon({ lat: 20, lon: 120 }, raw)).toBeNull()
  })

  it('风圈命中等级按 12 > 10 > 7', () => {
    const sorted = sortWindRadiiInnerFirst([radius('30KTS', 1, 1, 1, 1), radius('50KTS', 1, 1, 1, 1), radius('64KTS', 1, 1, 1, 1)].map((item, index) => ({ ...item, gradeText: ['七级', '十级', '十二级'][index] })))
    expect(sorted.map((item) => item.gradeText)).toEqual(['十二级', '十级', '七级'])
  })
})
