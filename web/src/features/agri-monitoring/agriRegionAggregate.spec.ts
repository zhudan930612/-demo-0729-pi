import { describe, it, expect } from 'vitest'
import { aggregateRegion, splitTownshipArea } from './agriRegionAggregate'
import type { NdviRaster } from './agriMonitoringTypes'

// 正方形 + 每一格不同 NDVI，验证 5级占比
const grid = {
  originLon: 0, originLat: 0, stepLon: 0.5, stepLat: 0.5, cols: 3, rows: 3, dates: ['d'],
  layers: [[10, 20, 30, 40, 50, 60, 70, 80, 90]], // NDVI×100: 0.1~0.9
} as unknown as NdviRaster

describe('aggregateRegion', () => {
  it('正方形内聚合出 5级占比', () => {
    const square = { type: 'Polygon', coordinates: [ [ [0, 0], [1, 0], [1, 1], [0, 1], [0, 0] ] ] }
    const a = aggregateRegion(grid, 0, square as never)
    expect(a).not.toBeNull()
    expect(Object.keys(a!.levels)).toHaveLength(5)
    // 4 个格心(0.25/0.75)×2 落在格内 → total≥4
    expect(Object.values(a!.levels).reduce((s, v) => s + v, 0)).toBeGreaterThan(0.99)
  })

  it('正方形外无数据返回 null', () => {
    expect(aggregateRegion(grid, 0, { type: 'Polygon', coordinates: [ [ [10, 10], [11, 10], [11, 11], [10, 11], [10, 10] ] ] } as never)).toBeNull()
  })

  it('村之和=镇：按农田面积占比拆分', () => {
    const splits = splitTownshipArea(1000, [
      { code: 'a', farmArea: 300 }, { code: 'b', farmArea: 700 },
    ])
    expect(splits[0]!.area).toBe(300)
    expect(splits[1]!.area).toBe(700)
    expect(splits[0]!.area + splits[1]!.area).toBe(1000)
  })
})
