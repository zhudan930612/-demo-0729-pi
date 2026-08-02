import { describe, expect, it } from 'vitest'
import { sortWindRadiiInnerFirst, windCirclePolygon } from './typhoonWindCircle'
import type { WindRadius } from './typhoonTypes'

function radius(grade: string, ne: number, se: number, sw: number, nw: number): WindRadius {
  return { grade, gradeText: grade, neRadiusKm: ne, seRadiusKm: se, swRadiusKm: sw, nwRadiusKm: nw }
}

describe('wind circle geometry', () => {
  it('四象限圆弧只在正北东南西轴线上形成直角阶差', () => {
    const polygon = windCirclePolygon({ lat: 20, lon: 120 }, radius('七级', 400, 300, 200, 100), 1)!
    expect(polygon).toHaveLength(9)
    // 每个象限包含起止轴向点；相邻象限端点共享同一经线或纬线，不允许斜向连接。
    expect(polygon[1]![0]).toBeCloseTo(20, 8)
    expect(polygon[2]![0]).toBeCloseTo(20, 8)
    expect(polygon[3]![1]).toBeCloseTo(120, 8)
    expect(polygon[4]![1]).toBeCloseTo(120, 8)
    expect(polygon[5]![0]).toBeCloseTo(20, 8)
    expect(polygon[6]![0]).toBeCloseTo(20, 8)
    expect(polygon[7]![1]).toBeCloseTo(120, 8)
    expect(polygon[8]).toEqual(polygon[0])
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
